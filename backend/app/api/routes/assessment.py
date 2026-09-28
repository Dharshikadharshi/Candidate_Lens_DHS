"""Phase 3 API: resume analysis, AI question plan, live AI interview, scoring and reports."""
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.ai.client import AIClient
from app.ai.roles import role_profiles
from app.ai.rubric import CATEGORIES, DIMENSIONS, RUBRIC_VERSION, SCORE_ANCHORS
from app.api.deps import get_ai_client, get_current_user, get_db, get_session_factory
from app.api.routes.candidates import get_candidate_or_404
from app.api.routes.interviews import commit_or_conflict, get_interview_context, require_role
from app.core.config import settings
from app.models.assessment import InterviewAnswer, InterviewAssessmentReport, InterviewQuestion
from app.models.interview import Interview
from app.models.user import User
from app.schemas.assessment import (
    AnswerSubmit, ConsentRequest, EvaluationReviewRequest, NextQuestionRequest, PlanCreateRequest,
    ReportReviewRequest, ResumeAnalysisRequest, TranscriptFlagRequest,
)
import re

from app.services import ai_interview, ai_usage, report_generation, resume_analysis
from app.services.report_pdf import render_report_pdf
from app.services.ai_interview import AIStateError
from app.services.interviews import as_aware, interviewer_present, record_event

logger = logging.getLogger(__name__)

router = APIRouter()


def state_error(exc: AIStateError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


def require_ai(ai: AIClient) -> None:
    if not ai.configured:
        raise HTTPException(status_code=503, detail="AI features are not configured. Set OPENAI_API_KEY on the backend.")


def cached_json(request: Request, payload: dict, tag: str) -> Response:
    """Weak ETag keyed on state versions: unchanged polls get a 304 with no body."""
    etag = f'W/"{tag}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache", "Vary": "Authorization, X-Invitation-Token"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(jsonable_encoder(payload), headers=headers)


def load_plan(db: Session, interview) -> "ai_interview.InterviewQuestionPlan":
    plan = ai_interview.get_plan(db, interview.id)
    if plan is None:
        raise HTTPException(status_code=404, detail="No AI question plan exists for this interview yet.")
    return plan


def require_interviewer_present(db: Session, interview, question: InterviewQuestion) -> None:
    """Candidates cannot continue answering alone: the interviewer must be in the call."""
    already_submitted = question.answer is not None and question.answer.status == "submitted"
    if not already_submitted and not interviewer_present(db, interview):
        raise HTTPException(status_code=409, detail="Your interviewer is not connected right now. Please wait for them to rejoin.")


def load_question(db: Session, interview, question_id: str) -> InterviewQuestion:
    try:
        q_id = uuid.UUID(question_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid question ID format")
    question = db.get(InterviewQuestion, q_id)
    if question is None or question.interview_id != interview.id:
        raise HTTPException(status_code=404, detail="Question not found for this interview.")
    return question


# --- Reference data ----------------------------------------------------------

@router.get("/ai/config")
def read_ai_config(current_user: User = Depends(get_current_user), ai: AIClient = Depends(get_ai_client)):
    return {
        "configured": ai.configured,
        "model": settings.OPENAI_MODEL,
        "transcription_model": settings.OPENAI_TRANSCRIPTION_MODEL,
        "rubric_version": RUBRIC_VERSION,
        "score_anchors": SCORE_ANCHORS,
        "dimensions": {k: v["label"] for k, v in DIMENSIONS.items()},
        "categories": {k: v["label"] for k, v in CATEGORIES.items()},
        "roles": [{"key": k, "label": v["label"]} for k, v in role_profiles().items()],
        "max_audio_seconds": settings.AI_MAX_AUDIO_SECONDS,
    }


# --- Resume analysis ---------------------------------------------------------

def serialize_analysis(analysis, candidate) -> dict:
    if analysis is None:
        return {"status": "not_started", "has_resume": candidate.resume is not None}
    return {
        "id": str(analysis.id),
        "status": analysis.status,
        "error": analysis.error,
        "has_resume": candidate.resume is not None,
        "stale": resume_analysis.is_stale(analysis, candidate.resume),
        "resume_filename": analysis.resume_filename,
        "profile": analysis.extracted_profile,
        "claims": analysis.extracted_claims or [],
        "stats": analysis.text_stats,
        "model_name": analysis.model_name,
        "prompt_version": analysis.prompt_version,
        "created_at": as_aware(analysis.created_at),
        "updated_at": as_aware(analysis.updated_at),
    }


@router.post("/candidates/{candidate_id}/resume-analysis", status_code=status.HTTP_202_ACCEPTED)
def start_resume_analysis(
    candidate_id: str,
    background_tasks: BackgroundTasks,
    body: Optional[ResumeAnalysisRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ai: AIClient = Depends(get_ai_client),
    session_factory=Depends(get_session_factory),
):
    require_ai(ai)
    candidate = get_candidate_or_404(db, candidate_id)
    try:
        analysis, needs_run = resume_analysis.request_analysis(db, candidate, force=bool(body and body.force))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if needs_run:
        background_tasks.add_task(resume_analysis.run_resume_analysis, session_factory, ai, analysis.id)
    return serialize_analysis(analysis, candidate)


@router.get("/candidates/{candidate_id}/resume-analysis")
def read_resume_analysis(candidate_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    candidate = get_candidate_or_404(db, candidate_id)
    return serialize_analysis(resume_analysis.latest_analysis(db, candidate.id), candidate)


# --- Question plan -----------------------------------------------------------

@router.post("/interviews/{interview_id}/ai-plan", status_code=status.HTTP_202_ACCEPTED)
def create_ai_plan(
    body: PlanCreateRequest,
    background_tasks: BackgroundTasks,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
    ai: AIClient = Depends(get_ai_client),
    session_factory=Depends(get_session_factory),
):
    interview, principal = ctx
    require_role(principal, "hr")
    require_ai(ai)
    try:
        plan, needs_run = ai_interview.create_or_reset_plan(db, interview, principal.user, body.config, body.regenerate)
    except AIStateError as exc:
        raise state_error(exc)
    if needs_run:
        record_event(db, interview, "ai_plan_requested", "hr", principal.user.id, details={"regenerate": body.regenerate})
        db.commit()
        background_tasks.add_task(ai_interview.run_plan_generation, session_factory, ai, plan.id)
    return ai_interview.serialize_plan(db, plan)


@router.get("/interviews/{interview_id}/ai-plan")
def read_ai_plan(ctx: tuple = Depends(get_interview_context), db: Session = Depends(get_db)):
    interview, principal = ctx
    require_role(principal, "hr")  # the full plan is never shown to the candidate
    plan = ai_interview.get_plan(db, interview.id)
    if plan is None:
        return {"status": "not_configured"}
    return ai_interview.serialize_plan(db, plan)


@router.post("/interviews/{interview_id}/ai-consent")
def record_consent(body: ConsentRequest, ctx: tuple = Depends(get_interview_context), db: Session = Depends(get_db)):
    interview, principal = ctx
    require_role(principal, "candidate")
    if not body.acknowledge_ai_disclosure:
        raise HTTPException(status_code=400, detail="Please acknowledge the AI-assisted assessment notice to continue.")
    plan = load_plan(db, interview)
    now = ai_interview.utcnow()
    plan.ai_disclosure_ack_at = plan.ai_disclosure_ack_at or now
    plan.transcription_consent = body.transcription_consent
    plan.transcription_consent_at = now
    ai_interview.touch(plan)
    record_event(db, interview, "ai_consent_recorded", "candidate",
                 details={"transcription_consent": body.transcription_consent})
    commit_or_conflict(db)
    db.refresh(plan)
    return ai_interview.serialize_current(plan, "candidate")


# --- Live interview ----------------------------------------------------------

@router.get("/interviews/{interview_id}/questions/current")
def read_current_question(request: Request, ctx: tuple = Depends(get_interview_context), db: Session = Depends(get_db)):
    interview, principal = ctx
    plan = ai_interview.get_plan(db, interview.id)
    present = interviewer_present(db, interview)
    tag = f"cur-{principal.role}-{interview.version}-{plan.version if plan else 0}-{int(present)}"
    payload = ai_interview.serialize_current(plan, principal.role, db)
    payload["interview_status"] = interview.status
    payload["interviewer_present"] = present
    return cached_json(request, payload, tag)


@router.post("/interviews/{interview_id}/questions/next")
def next_question(
    body: NextQuestionRequest,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
):
    interview, principal = ctx
    require_role(principal, "hr")
    plan = load_plan(db, interview)
    if body.version is not None and body.version != plan.version:
        raise HTTPException(status_code=409, detail="The AI interview changed. Reload to see the latest state.")
    previous = ai_interview.current_question(plan)
    try:
        if body.action == "start":
            ai_interview.start_ai_interview(plan, interview)
            record_event(db, interview, "ai_interview_started", "hr", principal.user.id)
        elif body.action == "skip":
            ai_interview.skip_current(plan, body.reason)
            record_event(db, interview, "ai_question_skipped", "hr", principal.user.id,
                         details={"question": ai_interview.question_label(previous) if previous else None})
        else:
            ai_interview.advance(plan)
    except AIStateError as exc:
        raise state_error(exc)
    commit_or_conflict(db)
    db.refresh(plan)
    return ai_interview.serialize_current(plan, "hr", db)


@router.post("/interviews/{interview_id}/questions/{question_id}/transcribe")
def transcribe_question_answer(
    question_id: str,
    audio: UploadFile = File(...),
    duration_seconds: Optional[float] = Form(None),
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
    ai: AIClient = Depends(get_ai_client),
    session_factory=Depends(get_session_factory),
):
    interview, principal = ctx
    require_role(principal, "candidate")
    require_ai(ai)
    plan = load_plan(db, interview)
    question = load_question(db, interview, question_id)
    require_interviewer_present(db, interview, question)
    limit = settings.AI_MAX_AUDIO_MB * 1024 * 1024
    data = audio.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"Recording is too large (max {settings.AI_MAX_AUDIO_MB} MB).")
    if duration_seconds is not None:
        duration_seconds = max(0.0, min(float(duration_seconds), settings.AI_MAX_AUDIO_SECONDS + 5))
    try:
        ai_interview.record_transcription(
            db, session_factory, ai, plan=plan, interview=interview, question=question, data=data,
            content_type=audio.content_type or "", duration_seconds=duration_seconds,
        )
    except AIStateError as exc:
        raise state_error(exc)
    plan = load_plan(db, interview)
    return ai_interview.serialize_current(plan, "candidate")


@router.post("/interviews/{interview_id}/questions/{question_id}/answer")
def submit_question_answer(
    question_id: str,
    body: AnswerSubmit,
    background_tasks: BackgroundTasks,
    response: Response,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
    ai: AIClient = Depends(get_ai_client),
    session_factory=Depends(get_session_factory),
):
    interview, principal = ctx
    require_role(principal, "candidate")
    plan = load_plan(db, interview)
    question = load_question(db, interview, question_id)
    require_interviewer_present(db, interview, question)
    try:
        answer, created = ai_interview.submit_answer(db, plan=plan, interview=interview, question=question, body=body)
    except AIStateError as exc:
        raise state_error(exc)
    if created:
        background_tasks.add_task(ai_interview.run_answer_evaluation, session_factory, ai, answer.id)
        response.status_code = status.HTTP_202_ACCEPTED
    db.refresh(plan)
    return ai_interview.serialize_current(plan, "candidate")


@router.post("/interviews/{interview_id}/questions/{question_id}/transcript-flag")
def flag_transcript(
    question_id: str,
    body: TranscriptFlagRequest,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
):
    interview, principal = ctx
    plan = load_plan(db, interview)
    question = load_question(db, interview, question_id)
    answer = question.answer
    if answer is None or answer.capture_method != "voice" or answer.status != "submitted":
        raise HTTPException(status_code=409, detail="Only submitted spoken answers can be flagged.")
    answer.transcript_flagged = body.flagged
    answer.transcript_flag_note = body.note if body.flagged else None
    answer.transcript_flagged_by = principal.role if body.flagged else None
    ai_interview.touch(plan)
    commit_or_conflict(db)
    return {"question_id": question_id, "transcript_flagged": answer.transcript_flagged}


@router.post("/interviews/{interview_id}/questions/{question_id}/evaluate", status_code=status.HTTP_202_ACCEPTED)
def evaluate_question_answer(
    question_id: str,
    background_tasks: BackgroundTasks,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
    ai: AIClient = Depends(get_ai_client),
    session_factory=Depends(get_session_factory),
):
    """Retry or re-run evaluation. Each run adds a new evaluation version; earlier ones are kept."""
    interview, principal = ctx
    require_role(principal, "hr")
    require_ai(ai)
    plan = load_plan(db, interview)
    question = load_question(db, interview, question_id)
    if question.answer is None:
        raise HTTPException(status_code=409, detail="This question has no answer to evaluate.")
    try:
        ai_interview.request_reevaluation(db, plan, question.answer)
    except AIStateError as exc:
        raise state_error(exc)
    background_tasks.add_task(ai_interview.run_answer_evaluation, session_factory, ai, question.answer.id)
    return {"question_id": question_id, "evaluation_status": "in_progress"}


@router.post("/interviews/{interview_id}/answers/{answer_id}/evaluations/review")
def review_answer_evaluation(
    answer_id: str,
    body: EvaluationReviewRequest,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
):
    interview, principal = ctx
    require_role(principal, "hr")
    plan = load_plan(db, interview)
    try:
        answer = db.get(InterviewAnswer, uuid.UUID(answer_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid answer ID format")
    if answer is None or answer.interview_id != interview.id:
        raise HTTPException(status_code=404, detail="Answer not found for this interview.")
    try:
        evaluation = ai_interview.review_evaluation(db, plan=plan, answer=answer, user=principal.user, body=body)
    except AIStateError as exc:
        raise state_error(exc)
    return ai_interview.serialize_evaluation(evaluation)


@router.get("/interviews/{interview_id}/assessment-progress")
def read_assessment_progress(request: Request, ctx: tuple = Depends(get_interview_context), db: Session = Depends(get_db)):
    interview, principal = ctx
    require_role(principal, "hr")
    plan = load_plan(db, interview)
    return cached_json(request, ai_interview.assessment_progress(db, plan), f"prog-{interview.version}-{plan.version}")


@router.post("/interviews/{interview_id}/ai-complete")
def complete_ai_interview(
    background_tasks: BackgroundTasks,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
    ai: AIClient = Depends(get_ai_client),
    session_factory=Depends(get_session_factory),
):
    interview, principal = ctx
    require_role(principal, "hr")
    plan = load_plan(db, interview)
    if plan.status not in ("active", "completed"):
        raise HTTPException(status_code=409, detail="The AI interview has not started.")
    changed = ai_interview.complete_plan(plan, "ended_by_interviewer")
    if changed:
        record_event(db, interview, "ai_interview_completed", "hr", principal.user.id)
    commit_or_conflict(db)
    if changed and ai.configured:
        background_tasks.add_task(report_generation.generate_after_completion, session_factory, ai, plan.id)
    db.refresh(plan)
    return ai_interview.serialize_current(plan, "hr", db)


# --- Reports -----------------------------------------------------------------

@router.post("/interviews/{interview_id}/report/generate", status_code=status.HTTP_202_ACCEPTED)
def generate_report(
    background_tasks: BackgroundTasks,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
    ai: AIClient = Depends(get_ai_client),
    session_factory=Depends(get_session_factory),
):
    interview, principal = ctx
    require_role(principal, "hr")
    require_ai(ai)
    plan = load_plan(db, interview)
    if plan.status != "completed" and interview.status != "completed":
        raise HTTPException(status_code=409, detail="Complete the AI interview before generating the final report.")
    report, needs_run = report_generation.request_report(db, interview.id)
    if needs_run:
        background_tasks.add_task(report_generation.run_report_generation, session_factory, ai, report.id)
    return report_generation.serialize_report(report)


@router.get("/interviews/{interview_id}/report")
def read_report(
    version: Optional[int] = None,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
):
    interview, principal = ctx
    require_role(principal, "hr")
    query = db.query(InterviewAssessmentReport).filter(InterviewAssessmentReport.interview_id == interview.id)
    report = (query.filter(InterviewAssessmentReport.report_version == version).first() if version
              else report_generation.latest_report(db, interview.id))
    if report is None:
        raise HTTPException(status_code=404, detail="No report has been generated for this interview.")
    versions = [v for (v,) in query.with_entities(InterviewAssessmentReport.report_version)
                .order_by(InterviewAssessmentReport.report_version).all()]
    return {**report_generation.serialize_report(report), "available_versions": versions}


@router.get("/interviews/{interview_id}/report/pdf")
def download_report_pdf(
    version: Optional[int] = None,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
):
    """The saved report (including the HR review) as a downloadable PDF."""
    interview, principal = ctx
    require_role(principal, "hr")
    query = db.query(InterviewAssessmentReport).filter(InterviewAssessmentReport.interview_id == interview.id)
    report = (query.filter(InterviewAssessmentReport.report_version == version).first() if version
              else report_generation.latest_report(db, interview.id))
    if report is None:
        raise HTTPException(status_code=404, detail="No report has been generated for this interview.")
    if report.status not in ("ready", "partial"):
        raise HTTPException(status_code=409, detail="The report is not ready yet.")
    pdf = render_report_pdf(jsonable_encoder(report_generation.serialize_report(report)))
    name = re.sub(r"[^A-Za-z0-9]+", "_", (report.candidate_info or {}).get("candidate_name") or "candidate").strip("_")
    filename = f"CandidateLens_Report_{name}_v{report.report_version}.pdf"
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-store",
    })


@router.patch("/reports/{report_id}/review")
def review_report(
    report_id: str,
    body: ReportReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        report = db.get(InterviewAssessmentReport, uuid.UUID(report_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid report ID format")
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    interview = db.get(Interview, report.interview_id)
    if interview is None or interview.interviewer_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the assigned interviewer can review this report.")
    if body.version is not None and body.version != report.version:
        raise HTTPException(status_code=409, detail="This report was changed elsewhere. Reload to see the latest state.")
    for field in ("hr_notes", "hr_clarifications", "hr_next_step", "hr_decision"):
        if field in body.model_fields_set:
            setattr(report, field, getattr(body, field))
    report.reviewed_by = current_user.id
    report.reviewer_name = current_user.name or current_user.email
    report.reviewed_at = ai_interview.utcnow()
    record_event(db, interview, "report_reviewed", "hr", current_user.id, details={"report_version": report.report_version})
    commit_or_conflict(db)
    db.refresh(report)
    return report_generation.serialize_report(report)


# --- Usage -------------------------------------------------------------------

@router.get("/interviews/{interview_id}/ai-usage")
def read_interview_usage(ctx: tuple = Depends(get_interview_context), db: Session = Depends(get_db)):
    interview, principal = ctx
    require_role(principal, "hr")
    return ai_usage.interview_usage(db, interview.id)


@router.get("/ai-usage/summary")
def read_usage_summary(
    projected_candidates: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return ai_usage.usage_summary(db, max(1, min(projected_candidates, 100000)))
