"""AI interview orchestration. The server owns question order, answer state and scores.

Plan:      generating -> ready -> active -> completed      (failed on generation error)
Question:  planned -> active -> answered/evaluating -> evaluated | evaluation_failed   (or skipped)

Exactly one question is active at a time (plan.current_question_id). Every state change
touches the plan row, whose version column provides optimistic locking and the polling ETag.
"""
import logging
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Callable, Optional

from sqlalchemy import func as sa_func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.ai.client import AIClient, AIError
from app.ai.rubric import CATEGORIES, DIMENSION_KEYS, DIMENSIONS, RUBRIC_VERSION
from app.ai.text import normalize
from app.models.assessment import AnswerEvaluation, InterviewAnswer, InterviewQuestion, InterviewQuestionPlan
from app.models.interview import Interview
from app.schemas.assessment import AIPlanConfig, AnswerSubmit, EvaluationReviewRequest
from app.services import answer_evaluation, question_generation, resume_analysis
from app.services.interviews import as_aware
from app.services.speech_to_text import AudioRejected, transcribe_answer

logger = logging.getLogger(__name__)

HANDLED_STATUSES = ("evaluated", "evaluation_failed", "skipped")
EVALUATION_STALE_AFTER = timedelta(minutes=5)
PLAN_GENERATION_STALE_AFTER = timedelta(minutes=5)


class AIStateError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def touch(plan: InterviewQuestionPlan) -> None:
    plan.updated_at = utcnow()  # guarantees a version bump even if only child rows changed


def question_label(q: InterviewQuestion) -> str:
    return f"Q{q.sequence_number}" + (f".{q.follow_up_index}" if q.is_follow_up else "")


def get_plan(db: Session, interview_id) -> Optional[InterviewQuestionPlan]:
    return db.query(InterviewQuestionPlan).filter(InterviewQuestionPlan.interview_id == interview_id).first()


def plan_config(plan: InterviewQuestionPlan) -> AIPlanConfig:
    return AIPlanConfig(**(plan.configuration or {}).get("requested", {}))


def current_question(plan: InterviewQuestionPlan) -> Optional[InterviewQuestion]:
    if not plan.current_question_id:
        return None
    return next((q for q in plan.questions if q.id == plan.current_question_id), None)


def _stale(ts: Optional[datetime], after: timedelta) -> bool:
    ts = as_aware(ts)
    return ts is None or utcnow() - ts > after


def apply_with_retry(session_factory: Callable[[], Session], fn: Callable[[Session], object], attempts: int = 4):
    """Run fn in a fresh session and commit; re-run on optimistic-lock conflicts."""
    for attempt in range(attempts):
        db = session_factory()
        try:
            result = fn(db)
            db.commit()
            return result
        except StaleDataError:
            db.rollback()
            if attempt == attempts - 1:
                raise
            time.sleep(0.05 * (attempt + 1))
        finally:
            db.close()


# --- Plan generation ---------------------------------------------------------

def create_or_reset_plan(db: Session, interview: Interview, user, config: AIPlanConfig,
                         regenerate: bool) -> tuple[InterviewQuestionPlan, bool]:
    """Return (plan, needs_generation). Idempotent: an existing ready plan is reused."""
    if interview.status not in ("request_pending", "accepted", "in_progress"):
        raise AIStateError(409, f"An AI plan cannot be prepared for a '{interview.status}' interview.")
    plan = get_plan(db, interview.id)
    if plan is not None:
        if plan.status in ("active", "completed"):
            raise AIStateError(409, "The AI interview has already started; its question plan can no longer change.")
        if plan.status == "generating" and not _stale(plan.updated_at, PLAN_GENERATION_STALE_AFTER):
            return plan, False
        if plan.status == "ready" and not regenerate:
            return plan, False
        for q in list(plan.questions):
            plan.questions.remove(q)
    else:
        plan = InterviewQuestionPlan(id=uuid.uuid4(), interview_id=interview.id)
        db.add(plan)
    plan.status = "generating"
    plan.error = None
    plan.role = (config.target_role or interview.candidate.target_role).strip()
    plan.difficulty = config.difficulty or "auto"
    plan.configuration = {"requested": config.model_dump()}
    plan.rubric_version = RUBRIC_VERSION
    plan.prompt_version = question_generation.PROMPT_VERSION
    plan.created_by = user.id
    touch(plan)
    db.commit()
    db.refresh(plan)
    return plan, True


def _usable_analysis(session_factory, ai: AIClient, db: Session, candidate):
    """Latest completed analysis for the current resume; runs one if needed. None if unavailable."""
    if candidate.resume is None:
        return None
    try:
        analysis, needs_run = resume_analysis.request_analysis(db, candidate)
    except ValueError:
        return None
    if needs_run:
        resume_analysis.run_resume_analysis(session_factory, ai, analysis.id)
    else:
        # Another job may be running it; wait briefly rather than paying twice.
        for _ in range(45):
            db.refresh(analysis)
            if analysis.status != "processing":
                break
            time.sleep(2)
    db.refresh(analysis)
    return analysis if analysis.status == "completed" else None


def run_plan_generation(session_factory: Callable[[], Session], ai: AIClient, plan_id) -> None:
    db = session_factory()
    try:
        plan = db.get(InterviewQuestionPlan, plan_id)
        if plan is None or plan.status != "generating":
            return
        interview = plan.interview
        candidate = interview.candidate
        config = plan_config(plan)
        try:
            if not ai.configured:
                raise AIError("not_configured", "OPENAI_API_KEY is not set")
            analysis = _usable_analysis(session_factory, ai, db, candidate)
            claims = [c for c in (analysis.extracted_claims or []) if c.get("source_verified")] if analysis else []
            counts, adjustments = question_generation.effective_config(config, interview.duration_minutes, bool(claims))
            difficulty = question_generation.resolve_difficulty(config, analysis.extracted_profile if analysis else None)
            questions, shortfalls, model = question_generation.generate_questions(
                ai, role=plan.role, difficulty=difficulty, counts=counts, claims=claims,
                projects=(analysis.extracted_profile or {}).get("projects", []) if analysis else [],
                interview_id=interview.id,
            )
        except (AIError, ValueError) as exc:
            db.rollback()
            plan = db.get(InterviewQuestionPlan, plan_id)
            plan.status = "failed"
            plan.error = exc.public_message() if isinstance(exc, AIError) else str(exc)
            touch(plan)
            db.commit()
            return

        db.refresh(plan)
        if plan.status != "generating":
            return  # superseded by a concurrent regenerate
        for index, q in enumerate(questions, start=1):
            db.add(InterviewQuestion(
                plan_id=plan.id, interview_id=interview.id, sequence_number=index, follow_up_index=0,
                is_follow_up=False, question_category=q["category"], text=q["text"], topic=q["topic"],
                source_claim=q["source_claim"], expected_evidence=q["expected_evidence"], dimensions=q["dimensions"],
                difficulty=difficulty, status="planned", rubric_version=RUBRIC_VERSION,
            ))
        plan.status = "ready"
        plan.difficulty = difficulty
        plan.model_name = model
        plan.resume_analysis_id = analysis.id if analysis else None
        plan.configuration = {
            **plan.configuration,
            "effective_counts": counts,
            "adjustments": adjustments + shortfalls,
            "resume_analysis_used": analysis is not None,
        }
        touch(plan)
        db.commit()
    except StaleDataError:
        db.rollback()
        logger.warning("plan %s changed during generation; discarding result", plan_id)
    except Exception:
        db.rollback()
        logger.exception("plan generation %s crashed", plan_id)
        plan = db.get(InterviewQuestionPlan, plan_id)
        if plan is not None and plan.status == "generating":
            plan.status, plan.error = "failed", "Unexpected error while generating the plan."
            touch(plan)
            db.commit()
    finally:
        db.close()


# --- Question sequence -------------------------------------------------------

def activate_next(plan: InterviewQuestionPlan, after: Optional[InterviewQuestion]) -> Optional[InterviewQuestion]:
    questions = plan.questions
    upcoming = None
    if after is not None and not after.is_follow_up:
        upcoming = next((q for q in questions if q.parent_question_id == after.id and q.status == "planned"), None)
    if upcoming is None:
        upcoming = next((q for q in questions if not q.is_follow_up and q.status == "planned"), None)
    if upcoming is None:
        plan.current_question_id = None
        complete_plan(plan, "all_questions_handled")
        return None
    upcoming.status = "active"
    upcoming.asked_at = utcnow()
    plan.current_question_id = upcoming.id
    return upcoming


def complete_plan(plan: InterviewQuestionPlan, reason: str) -> bool:
    if plan.status == "completed":
        return False
    active = current_question(plan)
    if active is not None and active.status == "active":
        active.status = "skipped"
        active.skip_reason = "The AI interview ended before this question was answered."
        active.handled_at = utcnow()
    plan.status = "completed"
    plan.completed_at = utcnow()
    plan.completion_reason = reason
    plan.current_question_id = None
    touch(plan)
    return True


def start_ai_interview(plan: InterviewQuestionPlan, interview: Interview) -> None:
    if plan.status == "active":
        return
    if plan.status != "ready":
        raise AIStateError(409, f"The question plan is '{plan.status}', not ready.")
    if interview.status != "in_progress":
        raise AIStateError(409, "Start the interview session before starting the AI interviewer.")
    plan.status = "active"
    plan.started_at = utcnow()
    activate_next(plan, None)
    touch(plan)


def skip_current(plan: InterviewQuestionPlan, reason: Optional[str]) -> None:
    if plan.status != "active":
        raise AIStateError(409, "The AI interview is not active.")
    question = current_question(plan)
    if question is None:
        raise AIStateError(409, "There is no active question to skip.")
    reason = (reason or "").strip() or "Skipped by the interviewer."
    if question.answer is not None and question.answer.status == "submitted":
        # Keep the evidence; the running evaluation will record but not advance.
        question.next_action = {"decision": "skipped_by_interviewer", "reason": reason, "decided_by": "hr",
                                "decided_at": utcnow().isoformat()}
    else:
        question.status = "skipped"
        question.skip_reason = reason
        question.handled_at = utcnow()
        question.next_action = {"decision": "skipped", "reason": reason, "decided_by": "hr",
                                "decided_at": utcnow().isoformat()}
    activate_next(plan, None)
    touch(plan)


def advance(plan: InterviewQuestionPlan) -> None:
    if plan.status != "active":
        raise AIStateError(409, "The AI interview is not active.")
    question = current_question(plan)
    if question is not None and question.status not in HANDLED_STATUSES:
        raise AIStateError(409, "The current answer has not been handled yet. Wait for it, or skip the question.")
    activate_next(plan, question)
    touch(plan)


def _require_active_question(plan: InterviewQuestionPlan, interview: Interview, question: InterviewQuestion) -> None:
    if interview.status != "in_progress":
        raise AIStateError(409, "The interview session is not in progress.")
    if plan.status != "active":
        raise AIStateError(409, "The AI interview is not active.")
    if question.plan_id != plan.id:
        raise AIStateError(404, "Question not found for this interview.")
    if plan.current_question_id != question.id or question.status != "active":
        raise AIStateError(409, "This question is not the active question.")


# --- Answers -----------------------------------------------------------------

def record_transcription(db: Session, session_factory: Callable[[], Session], ai: AIClient, *, plan, interview,
                         question, data: bytes, content_type: str, duration_seconds: Optional[float]):
    """Transcribe a recorded answer into a draft (not yet submitted). Returns the answer id."""
    _require_active_question(plan, interview, question)
    config = plan_config(plan)
    if not config.speech_to_text_enabled:
        raise AIStateError(403, "Spoken answers are disabled for this interview. Please type your answer.")
    if not plan.transcription_consent:
        raise AIStateError(403, "Consent to transcription is required before recording an answer.")
    answer = question.answer
    if answer is not None and answer.status == "submitted":
        raise AIStateError(409, "This question has already been answered.")
    if answer is None:
        answer = InterviewAnswer(question_id=question.id, interview_id=interview.id, capture_method="voice")
        db.add(answer)
    answer.capture_method = "voice"
    answer.transcription_status = "processing"
    answer.transcription_error = None
    touch(plan)
    try:
        db.commit()  # lets HR see "processing" while the provider works
    except IntegrityError:
        db.rollback()
        raise AIStateError(409, "An answer is already being recorded for this question.")
    answer_id = answer.id

    status, text, error = "completed", None, None
    try:
        text = transcribe_answer(ai, data=data, content_type=content_type, duration_seconds=duration_seconds,
                                 topic=question.topic, interview_id=interview.id)
        if not text.strip():
            status, error = "empty", "No speech was detected. Please try again or type your answer."
    except AudioRejected as exc:
        status, error = ("empty" if exc.status == "empty" else "failed"), exc.message
    except AIError as exc:
        status, error = "failed", exc.public_message()

    def apply(session: Session):
        a = session.get(InterviewAnswer, answer_id)
        if a.status == "submitted":
            return
        a.transcription_status = status
        a.transcription_error = error
        a.audio_duration_seconds = duration_seconds
        if status == "completed":
            a.transcript_text = text
            a.answer_text = text
            a.transcript_edited = False
        touch(a.question.plan)

    apply_with_retry(session_factory, apply)
    db.expire_all()
    return answer_id


def submit_answer(db: Session, *, plan, interview, question, body: AnswerSubmit) -> tuple[InterviewAnswer, bool]:
    """Return (answer, created). A retried submission with the same idempotency key is a no-op."""
    existing = question.answer
    if existing is not None and existing.status == "submitted":
        if existing.idempotency_key == body.idempotency_key:
            return existing, False
        raise AIStateError(409, "This question has already been answered.")
    _require_active_question(plan, interview, question)
    config = plan_config(plan)
    text = body.answer_text.strip()
    if len(text) < 2:
        raise AIStateError(422, "The answer cannot be empty.")

    if body.capture_method == "typed":
        if not config.typed_answers_allowed:
            raise AIStateError(403, "Typed answers are disabled for this interview.")
        answer = existing or InterviewAnswer(question_id=question.id, interview_id=interview.id)
        answer.capture_method = "typed"
        answer.transcription_status = "not_applicable"
        answer.transcript_text = None
        answer.transcript_edited = False
    else:
        if existing is None or existing.transcription_status != "completed":
            raise AIStateError(409, "Record your answer and wait for the transcript before submitting.")
        answer = existing
        answer.transcript_edited = normalize(text) != normalize(answer.transcript_text or "")

    answer.answer_text = text
    answer.transcript_flagged = body.transcript_flagged and body.capture_method == "voice"
    answer.transcript_flag_note = (body.transcript_flag_note or None) if answer.transcript_flagged else None
    answer.transcript_flagged_by = "candidate" if answer.transcript_flagged else None
    answer.status = "submitted"
    answer.submitted_at = utcnow()
    answer.idempotency_key = body.idempotency_key
    answer.evaluation_status = "in_progress"
    answer.evaluation_started_at = utcnow()
    answer.evaluation_attempts = (answer.evaluation_attempts or 0) + 1
    if answer not in db:
        db.add(answer)
    question.status = "evaluating"
    touch(plan)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AIStateError(409, "This question has already been answered.")
    db.refresh(answer)
    return answer, True


def request_reevaluation(db: Session, plan, answer: InterviewAnswer) -> None:
    if answer.status != "submitted":
        raise AIStateError(409, "Only submitted answers can be evaluated.")
    if answer.evaluation_status == "in_progress" and not _stale(answer.evaluation_started_at, EVALUATION_STALE_AFTER):
        raise AIStateError(409, "An evaluation is already in progress for this answer.")
    answer.evaluation_status = "in_progress"
    answer.evaluation_started_at = utcnow()
    answer.evaluation_attempts = (answer.evaluation_attempts or 0) + 1
    answer.question.status = "evaluating"
    touch(plan)
    db.commit()


def _elapsed_over_budget(interview: Interview) -> bool:
    started = as_aware(interview.started_at)
    return bool(started) and utcnow() - started > timedelta(minutes=interview.duration_minutes)


def run_answer_evaluation(session_factory: Callable[[], Session], ai: AIClient, answer_id) -> None:
    """Background job: evaluate, decide the next action, advance. Never fabricates a result."""
    db = session_factory()
    try:
        answer = db.get(InterviewAnswer, answer_id)
        if answer is None or answer.status != "submitted" or answer.evaluation_status != "in_progress":
            return
        question = answer.question
        plan = question.plan
        interview = plan.interview
        config = plan_config(plan)
        output, rows, error = None, None, None
        try:
            output, model = answer_evaluation.evaluate_answer(ai, question=question, answer=answer, interview_id=interview.id)
            rows = answer_evaluation.validate_evaluation(output, question=question, answer=answer, model=model)
        except AIError as exc:
            error = exc

        decision = None
        if plan.status == "active" and plan.current_question_id == question.id and not (question.next_action or {}).get("decision") == "skipped_by_interviewer":
            try:
                decision = answer_evaluation.decide_next_action(
                    ai, question=question, answer=answer, evaluation=output if rows else None,
                    max_follow_ups=config.max_follow_ups_per_question, over_time=_elapsed_over_budget(interview),
                    interview_id=interview.id,
                )
            except AIError as exc:
                decision = {"decision": "next_question", "reason": f"Follow-up generation failed ({exc.kind}); continuing.",
                            "decided_by": "rules", "follow_up_question": None}
        missing = output.missing_evidence[:5] if output is not None and rows is not None else []
    finally:
        db.close()

    def apply(session: Session):
        a = session.get(InterviewAnswer, answer_id)
        q = a.question
        p = q.plan
        if rows is not None:
            base = session.query(sa_func.max(AnswerEvaluation.evaluation_version)).filter(
                AnswerEvaluation.answer_id == a.id).scalar() or 0
            for row in rows:
                session.add(AnswerEvaluation(answer_id=a.id, question_id=q.id, interview_id=a.interview_id,
                                             evaluation_version=base + 1, **row))
            a.evaluation_status = "completed"
            a.evaluation_error = None
            a.transcript_quality = output.transcript_quality
            a.answer_addresses_question = output.answer_addresses_question
            a.evidence_sufficient = output.evidence_sufficient
            a.missing_evidence = missing
            q.status = "evaluated"
        else:
            a.evaluation_status = "failed"
            a.evaluation_error = error.public_message()
            q.status = "evaluation_failed"
        q.handled_at = q.handled_at or utcnow()

        completed_now = False
        if decision and p.status == "active" and p.current_question_id == q.id:
            decision_record = {**decision, "decided_at": utcnow().isoformat()}
            if decision["decision"] == "follow_up":
                follow_up = InterviewQuestion(
                    plan_id=p.id, interview_id=q.interview_id, sequence_number=q.sequence_number, follow_up_index=1,
                    is_follow_up=True, parent_question_id=q.id, question_category=q.question_category,
                    text=decision["follow_up_question"], topic=q.topic, source_claim=q.source_claim,
                    expected_evidence=missing, dimensions=q.dimensions, difficulty=q.difficulty,
                    status="planned", rubric_version=q.rubric_version,
                )
                p.questions.append(follow_up)
                session.flush()
                decision_record["follow_up_question_id"] = str(follow_up.id)
            q.next_action = decision_record
            activate_next(p, q)
            completed_now = p.status == "completed"
        touch(p)
        return completed_now, p.id

    completed_now, plan_id = apply_with_retry(session_factory, apply)
    if completed_now:
        from app.services import report_generation
        report_generation.generate_after_completion(session_factory, ai, plan_id)


def review_evaluation(db: Session, *, plan, answer: InterviewAnswer, user, body: EvaluationReviewRequest) -> AnswerEvaluation:
    question = answer.question
    if body.dimension not in question.dimensions:
        raise AIStateError(400, "This dimension does not apply to the question.")
    current = latest_evaluations(db, answer.interview_id).get((answer.id, body.dimension))
    if current is None and body.action == "confirm":
        raise AIStateError(409, "There is no evaluation to confirm.")
    version = (db.query(sa_func.max(AnswerEvaluation.evaluation_version))
               .filter(AnswerEvaluation.answer_id == answer.id).scalar() or 0) + 1
    note = body.note.strip()
    if body.action == "override":
        status, score, rationale = "scored", body.score, f"HR override: {note}"
    elif body.action == "mark_needs_review":
        status, score, rationale = "needs_review", None, f"Marked for manual review by HR: {note}"
    else:
        status, score = current.evidence_status, current.score
        rationale = f"{current.rationale} (Confirmed by HR: {note})"
    evaluation = AnswerEvaluation(
        answer_id=answer.id, question_id=question.id, interview_id=answer.interview_id, dimension=body.dimension,
        evaluation_version=version, source="hr", evidence_status=status, score=score, rubric_version=RUBRIC_VERSION,
        rationale=rationale[:1000], evidence_excerpt=current.evidence_excerpt if current else None,
        excerpt_verified=current.excerpt_verified if current else None, confidence_label="high",
        review_status="needs_review" if body.action == "mark_needs_review" else "reviewed", reviewer_id=user.id,
    )
    db.add(evaluation)
    touch(plan)
    db.commit()
    return evaluation


# --- Aggregation -------------------------------------------------------------

def latest_evaluations(db: Session, interview_id) -> dict:
    """Current evaluation per (answer_id, dimension) = highest evaluation_version."""
    rows = (db.query(AnswerEvaluation).filter(AnswerEvaluation.interview_id == interview_id)
            .order_by(AnswerEvaluation.evaluation_version).all())
    return {(r.answer_id, r.dimension): r for r in rows}


def assessment_progress(db: Session, plan: InterviewQuestionPlan) -> dict:
    """Deterministic, documented aggregation. Unscored evidence never becomes a number."""
    current = latest_evaluations(db, plan.interview_id)
    questions = plan.questions
    per_dim = {key: {"scores": [], "evaluated": 0, "awaiting": 0, "needs_review": 0, "insufficient": 0, "failed": 0,
                     "latest": None} for key in DIMENSION_KEYS}

    for q in questions:
        a = q.answer
        if a is None or a.status != "submitted":
            continue
        for dim in q.dimensions:
            bucket = per_dim[dim]
            if a.evaluation_status in ("not_started", "in_progress"):
                bucket["awaiting"] += 1
                continue
            ev = current.get((a.id, dim))
            if ev is None:
                bucket["failed"] += 1
                continue
            status = ev.evidence_status
            if dim == "communication_clarity" and a.transcript_flagged and ev.source == "ai" and status == "scored":
                status = "needs_review"  # flagged transcripts never count against clarity
            if status == "scored" and ev.score is not None:
                bucket["scores"].append(ev.score)
                bucket["evaluated"] += 1
                bucket["latest"] = {"question": question_label(q), "rationale": ev.rationale,
                                    "excerpt": ev.evidence_excerpt, "score": ev.score}
            elif status == "needs_review":
                bucket["needs_review"] += 1
            else:
                bucket["insufficient"] += 1

    dimensions = []
    for key, b in per_dim.items():
        count = len(b["scores"])
        evidence_status = ("not_enough_evidence" if count == 0 else "limited_evidence" if count == 1
                           else "sufficient_evidence")
        dimensions.append({
            "dimension": key,
            "label": DIMENSIONS[key]["label"],
            "average": round(mean(b["scores"]), 2) if count else None,
            "evaluated_answers": b["evaluated"],
            "awaiting_evaluation": b["awaiting"],
            "needs_review": b["needs_review"],
            "insufficient_data": b["insufficient"],
            "evaluation_failed": b["failed"],
            "evidence_status": evidence_status,
            "review_status": "needs_review" if (b["needs_review"] or b["failed"]) else "ok",
            "latest_evidence": b["latest"],
        })

    main = [q for q in questions if not q.is_follow_up]
    return {
        "provisional": plan.status != "completed",
        "rubric_version": plan.rubric_version,
        "plan_status": plan.status,
        "dimensions": dimensions,
        "questions": {
            "planned_main": len(main),
            "follow_ups": sum(1 for q in questions if q.is_follow_up),
            "answered": sum(1 for q in questions if q.answer is not None and q.answer.status == "submitted"),
            "evaluated": sum(1 for q in questions if q.status == "evaluated"),
            "awaiting_evaluation": sum(1 for q in questions if q.status == "evaluating"),
            "evaluation_failed": sum(1 for q in questions if q.status == "evaluation_failed"),
            "skipped": sum(1 for q in questions if q.status == "skipped"),
            "remaining": sum(1 for q in main if q.status in ("planned", "active")),
        },
    }


# --- Serialization -----------------------------------------------------------

def answer_state(question: InterviewQuestion, role: str) -> str:
    a = question.answer
    if a is None:
        return "waiting_for_answer"
    if a.status != "submitted":
        return {"processing": "processing", "completed": "transcript_ready", "empty": "transcription_failed",
                "failed": "transcription_failed"}.get(a.transcription_status, "waiting_for_answer")
    if role == "candidate":
        return "answer_submitted"  # candidates never see evaluation state
    return {"in_progress": "evaluation_in_progress", "completed": "evaluation_completed",
            "failed": "evaluation_failed"}.get(a.evaluation_status, "answer_submitted")


def serialize_answer(a: Optional[InterviewAnswer], role: str) -> Optional[dict]:
    if a is None:
        return None
    data = {
        "id": str(a.id),
        "status": a.status,
        "capture_method": a.capture_method,
        "transcription_status": a.transcription_status,
        "transcription_error": a.transcription_error,
        "transcript_text": a.transcript_text,
        "answer_text": a.answer_text,
        "transcript_edited": a.transcript_edited,
        "transcript_flagged": a.transcript_flagged,
        "submitted_at": as_aware(a.submitted_at),
        "idempotency_key": a.idempotency_key,
    }
    if role == "hr":
        data.update({
            "evaluation_status": a.evaluation_status,
            "evaluation_error": a.evaluation_error,
            "evaluation_attempts": a.evaluation_attempts,
            "transcript_quality": a.transcript_quality,
            "transcript_flag_note": a.transcript_flag_note,
            "transcript_flagged_by": a.transcript_flagged_by,
            "missing_evidence": a.missing_evidence or [],
            "audio_duration_seconds": a.audio_duration_seconds,
        })
    return data


def serialize_question(q: InterviewQuestion, role: str, total_main: int, evaluations: Optional[dict] = None) -> dict:
    data = {
        "id": str(q.id),
        "label": question_label(q),
        "number": q.sequence_number,
        "total": total_main,
        "is_follow_up": q.is_follow_up,
        "text": q.text,
        "category_label": CATEGORIES[q.question_category]["candidate_label" if role == "candidate" else "label"],
        "answer_state": answer_state(q, role),
        "answer": serialize_answer(q.answer, role),
    }
    if role == "hr":
        data.update({
            "category": q.question_category,
            "status": q.status,
            "topic": q.topic,
            "dimensions": q.dimensions,
            "expected_evidence": q.expected_evidence or [],
            "source_claim": q.source_claim,
            "skip_reason": q.skip_reason,
            "next_action": q.next_action,
            "parent_question_id": str(q.parent_question_id) if q.parent_question_id else None,
            "asked_at": as_aware(q.asked_at),
        })
        if evaluations is not None and q.answer is not None:
            data["evaluations"] = [
                serialize_evaluation(ev) for (answer_id, _), ev in evaluations.items() if answer_id == q.answer.id
            ]
    return data


def serialize_evaluation(ev: AnswerEvaluation) -> dict:
    return {
        "id": str(ev.id),
        "dimension": ev.dimension,
        "dimension_label": DIMENSIONS[ev.dimension]["label"],
        "evidence_status": ev.evidence_status,
        "score": ev.score,
        "rationale": ev.rationale,
        "evidence_excerpt": ev.evidence_excerpt,
        "excerpt_verified": ev.excerpt_verified,
        "confidence": ev.confidence_label,
        "review_status": ev.review_status,
        "source": ev.source,
        "rubric_version": ev.rubric_version,
        "evaluation_version": ev.evaluation_version,
        "model_name": ev.model_name,
        "created_at": as_aware(ev.created_at),
    }


def serialize_current(plan: Optional[InterviewQuestionPlan], role: str, db: Optional[Session] = None) -> dict:
    if plan is None:
        return {"plan_status": "not_configured", "question": None, "consent": None, "capture": None}
    config = plan_config(plan)
    total_main = sum(1 for q in plan.questions if not q.is_follow_up)
    question = current_question(plan)
    evaluations = latest_evaluations(db, plan.interview_id) if (role == "hr" and db is not None) else None
    return {
        "plan_status": plan.status,
        "plan_version": plan.version,
        "question": serialize_question(question, role, total_main, evaluations) if question else None,
        "answered_count": sum(1 for q in plan.questions if q.answer is not None and q.answer.status == "submitted"),
        "total_main": total_main,
        "consent": {
            "ai_disclosure_acknowledged": plan.ai_disclosure_ack_at is not None,
            "transcription_consent": plan.transcription_consent,
        },
        "capture": {
            "voice": config.speech_to_text_enabled and bool(plan.transcription_consent),
            "voice_enabled": config.speech_to_text_enabled,
            "typed": config.typed_answers_allowed,
            "max_audio_seconds": None,
        },
        "completed": plan.status == "completed",
    }


def serialize_plan(db: Session, plan: InterviewQuestionPlan) -> dict:
    evaluations = latest_evaluations(db, plan.interview_id)
    total_main = sum(1 for q in plan.questions if not q.is_follow_up)
    return {
        "id": str(plan.id),
        "interview_id": str(plan.interview_id),
        "status": plan.status,
        "error": plan.error,
        "role": plan.role,
        "difficulty": plan.difficulty,
        "configuration": plan.configuration,
        "rubric_version": plan.rubric_version,
        "prompt_version": plan.prompt_version,
        "model_name": plan.model_name,
        "resume_analysis_id": str(plan.resume_analysis_id) if plan.resume_analysis_id else None,
        "current_question_id": str(plan.current_question_id) if plan.current_question_id else None,
        "started_at": as_aware(plan.started_at),
        "completed_at": as_aware(plan.completed_at),
        "completion_reason": plan.completion_reason,
        "consent": {
            "ai_disclosure_acknowledged": plan.ai_disclosure_ack_at is not None,
            "transcription_consent": plan.transcription_consent,
        },
        "version": plan.version,
        "questions": [serialize_question(q, "hr", total_main, evaluations) for q in plan.questions],
    }
