"""API routes for AI Resume Validation workflow."""
import logging
import uuid
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.ai.client import AIClient
from app.api.deps import get_ai_client, get_current_user, get_db, get_session_factory
from app.api.routes.candidates import get_candidate_or_404
from app.models.candidate import Candidate
from app.models.user import User
from app.models.validation import ResumeValidationReport
from app.schemas.validation import ValidationReportResponse, ValidationReportSummary, ValidationStartRequest
from app.services import resume_validation
from app.services.validation_pdf import render_validation_pdf

logger = logging.getLogger(__name__)

router = APIRouter()


def require_ai(ai: AIClient) -> None:
    if not ai.configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features are not configured. Set OPENAI_API_KEY on the backend.",
        )


def check_candidate_access(candidate: Candidate, current_user: User) -> None:
    if candidate.created_by and candidate.created_by != current_user.id and getattr(current_user, "role", "") != "admin":
        raise HTTPException(status_code=404, detail="Validation report not found")


def _format_report(report: Optional[ResumeValidationReport], candidate: Candidate) -> dict:
    if report is None:
        return {
            "id": uuid.uuid4(),
            "candidate_id": candidate.id,
            "resume_id": candidate.resume.id if candidate.resume else None,
            "resume_filename": candidate.resume.original_filename if candidate.resume else None,
            "target_role": candidate.target_role,
            "status": "not_started",
            "overall_score": None,
            "rubric_version": "rv-1.0",
            "version": 0,
            "has_resume": candidate.resume is not None,
        }
    data = {
        "id": report.id,
        "candidate_id": report.candidate_id,
        "resume_id": report.resume_id,
        "resume_filename": report.resume_filename or (candidate.resume.original_filename if candidate.resume else None),
        "target_role": report.target_role,
        "experience_level": report.experience_level,
        "status": report.status,
        "overall_score": report.overall_score,
        "category_scores": report.category_scores,
        "detailed_findings": report.detailed_findings,
        "skills_evidence_map": report.skills_evidence_map,
        "suggested_questions": report.suggested_questions,
        "summary": report.summary,
        "error": report.error,
        "rubric_version": report.rubric_version,
        "model_name": report.model_name,
        "prompt_version": report.prompt_version,
        "version": report.version,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
        "has_resume": candidate.resume is not None,
    }
    return data


@router.post("/candidates/{candidate_id}/resume-validation", status_code=status.HTTP_202_ACCEPTED)
def start_resume_validation(
    candidate_id: str,
    background_tasks: BackgroundTasks,
    body: Optional[ValidationStartRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ai: AIClient = Depends(get_ai_client),
    session_factory=Depends(get_session_factory),
):
    """Start or retrieve validation for the candidate's resume and target role."""
    require_ai(ai)
    candidate = get_candidate_or_404(db, candidate_id)
    check_candidate_access(candidate, current_user)

    target_role = body.target_role if body and body.target_role else candidate.target_role
    force = bool(body and body.force)

    try:
        report, needs_run = resume_validation.request_validation(
            db=db,
            candidate=candidate,
            target_role=target_role,
            user_id=current_user.id,
            force=force,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    if needs_run:
        background_tasks.add_task(resume_validation.run_validation, session_factory, ai, report.id)

    return _format_report(report, candidate)


@router.get("/candidates/{candidate_id}/resume-validation")
def get_candidate_validation_history(
    candidate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List validation reports history for this candidate."""
    candidate = get_candidate_or_404(db, candidate_id)
    check_candidate_access(candidate, current_user)
    reports = resume_validation.list_validations(db, candidate.id)
    latest = reports[0] if reports else None

    return {
        "candidate_id": str(candidate.id),
        "candidate_name": candidate.full_name,
        "has_resume": candidate.resume is not None,
        "latest": _format_report(latest, candidate) if latest else None,
        "history": [
            {
                "id": str(r.id),
                "target_role": r.target_role,
                "status": r.status,
                "overall_score": r.overall_score,
                "version": r.version,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "resume_filename": r.resume_filename,
            }
            for r in reports
        ],
    }


@router.get("/resume-validation/{report_id}", response_model=ValidationReportResponse)
def get_validation_report(
    report_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch a specific validation report by ID."""
    try:
        r_uuid = uuid.UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Validation report not found")

    report = resume_validation.get_validation_by_id(db, r_uuid)
    if not report:
        raise HTTPException(status_code=404, detail="Validation report not found")

    candidate = db.get(Candidate, report.candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate associated with this report not found")
    check_candidate_access(candidate, current_user)

    return _format_report(report, candidate)


@router.post("/resume-validation/{report_id}/regenerate", status_code=status.HTTP_202_ACCEPTED)
def regenerate_validation(
    report_id: str,
    background_tasks: BackgroundTasks,
    body: Optional[ValidationStartRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ai: AIClient = Depends(get_ai_client),
    session_factory=Depends(get_session_factory),
):
    """Regenerate a validation report creating a new version."""
    require_ai(ai)
    try:
        r_uuid = uuid.UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Validation report not found")

    old_report = resume_validation.get_validation_by_id(db, r_uuid)
    if not old_report:
        raise HTTPException(status_code=404, detail="Validation report not found")

    candidate = db.get(Candidate, old_report.candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    check_candidate_access(candidate, current_user)

    target_role = (body.target_role if body and body.target_role else old_report.target_role)

    try:
        new_report, needs_run = resume_validation.request_validation(
            db=db,
            candidate=candidate,
            target_role=target_role,
            user_id=current_user.id,
            force=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    if needs_run:
        background_tasks.add_task(resume_validation.run_validation, session_factory, ai, new_report.id)

    return _format_report(new_report, candidate)


@router.get("/resume-validation/{report_id}/download")
def download_validation_report_pdf(
    report_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download the generated validation report as a formatted PDF."""
    try:
        r_uuid = uuid.UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Validation report not found")

    report = resume_validation.get_validation_by_id(db, r_uuid)
    if not report:
        raise HTTPException(status_code=404, detail="Validation report not found")

    candidate = db.get(Candidate, report.candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    check_candidate_access(candidate, current_user)

    report_dict = _format_report(report, candidate)
    candidate_dict = {
        "full_name": candidate.full_name,
        "email": candidate.email,
        "phone": candidate.phone,
        "target_role": candidate.target_role,
    }

    try:
        pdf_bytes = render_validation_pdf(report_dict, candidate_dict)
    except Exception as exc:
        logger.exception("Error rendering validation PDF for %s: %s", report_id, exc)
        raise HTTPException(status_code=500, detail="Could not generate PDF report.")

    safe_name = "".join(c for c in candidate.full_name if c.isalnum() or c in ("-", "_")).strip() or "Candidate"
    filename = f"Resume_Validation_{safe_name}_v{report.version}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
