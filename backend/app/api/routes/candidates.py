from typing import Any, Optional
import os
import uuid
import shutil
from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from datetime import timedelta, timezone
from app.api.deps import get_db, get_current_user
from app.models.candidate import Candidate
from app.models.user import User
from app.models.resume import Resume
from app.models.interview import Interview, ACTIVE_INTERVIEW_STATUSES
from app.schemas.candidate import CandidateListResponse, ResumeInfo, CandidateCreate, CandidateResponse, CandidateStatusUpdate, CandidateDetailResponse
from app.schemas.interview import InterviewCreate, InterviewCreatedResponse, InterviewListResponse
from app.api.routes.interviews import Principal, to_response, commit_or_conflict
from app.services import interviews as lifecycle

router = APIRouter()

MAX_SCHEDULE_AHEAD_DAYS = 180


def get_candidate_or_404(db: Session, candidate_id: str) -> Candidate:
    try:
        c_id = uuid.UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid candidate ID format")
    candidate = db.query(Candidate).filter(Candidate.id == c_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return candidate

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads", "resumes")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}
ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

@router.get("", response_model=CandidateListResponse)
def read_candidates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    search: Optional[str] = None,
    role: Optional[str] = None,
    status: Optional[str] = None,
) -> Any:
    query = db.query(Candidate)

    if search:
        query = query.filter(
            (Candidate.full_name.ilike(f"%{search}%")) |
            (Candidate.email.ilike(f"%{search}%"))
        )
    if role:
        query = query.filter(Candidate.target_role == role)
    if status:
        query = query.filter(Candidate.status == status)

    total = query.count()
    items = query.all()

    return {"items": items, "total": total}

@router.post("", response_model=CandidateResponse, status_code=status.HTTP_201_CREATED)
def create_candidate(
    candidate: CandidateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    existing = db.query(Candidate).filter(Candidate.email == candidate.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Candidate with this email already exists.")
    
    new_candidate = Candidate(
        full_name=candidate.full_name,
        email=candidate.email,
        phone=candidate.phone,
        target_role=candidate.target_role,
        status="awaiting_assessment",
        created_by=current_user.id
    )
    db.add(new_candidate)
    db.commit()
    db.refresh(new_candidate)
    return new_candidate

@router.post("/{candidate_id}/resume", response_model=ResumeInfo)
def upload_resume(
    candidate_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        c_id = uuid.UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid candidate ID format")
        
    candidate = db.query(Candidate).filter(Candidate.id == c_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS or file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file format. Please upload PDF, DOC, or DOCX.")

    file.file.seek(0, os.SEEK_END)
    file_size = file.file.tell()
    file.file.seek(0)

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 10MB.")

    # Generate safe unique filename
    stored_filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(UPLOAD_DIR, stored_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    existing_resume = db.query(Resume).filter(Resume.candidate_id == c_id).first()
    if existing_resume:
        # Delete old file
        if os.path.exists(existing_resume.file_path):
            os.remove(existing_resume.file_path)
            
        existing_resume.original_filename = file.filename
        existing_resume.stored_filename = stored_filename
        existing_resume.file_path = file_path
        existing_resume.file_type = file.content_type
        existing_resume.file_size = file_size
        db.commit()
        db.refresh(existing_resume)
        return existing_resume
    else:
        new_resume = Resume(
            candidate_id=candidate.id,
            original_filename=file.filename,
            stored_filename=stored_filename,
            file_path=file_path,
            file_type=file.content_type,
            file_size=file_size
        )
        db.add(new_resume)
        db.commit()
        db.refresh(new_resume)
        return new_resume

@router.get("/{candidate_id}/resume", response_model=ResumeInfo)
def get_resume_metadata(
    candidate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        c_id = uuid.UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid candidate ID format")
        
    resume = db.query(Resume).filter(Resume.candidate_id == c_id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    return resume

@router.get("/{candidate_id}/resume/download")
def download_resume(
    candidate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        c_id = uuid.UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid candidate ID format")
        
    resume = db.query(Resume).filter(Resume.candidate_id == c_id).first()
    if not resume or not os.path.exists(resume.file_path):
        raise HTTPException(status_code=404, detail="Resume file not found")
        
    return FileResponse(
        path=resume.file_path,
        filename=resume.original_filename,
        media_type=resume.file_type,
        content_disposition_type="inline"
    )

@router.patch("/{candidate_id}/status", response_model=CandidateResponse)
def update_candidate_status(
    candidate_id: str,
    status_update: CandidateStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    valid_statuses = ["awaiting_assessment", "assessment_in_progress", "completed", "report_pending"]
    if status_update.status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid candidate status.")

    try:
        c_id = uuid.UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid candidate ID format")
        
    candidate = db.query(Candidate).filter(Candidate.id == c_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    candidate.status = status_update.status
    db.commit()
    db.refresh(candidate)
    return candidate

@router.delete("/{candidate_id}")
def delete_candidate(
    candidate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        c_id = uuid.UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid candidate ID format")
        
    candidate = db.query(Candidate).filter(Candidate.id == c_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    resume = db.query(Resume).filter(Resume.candidate_id == c_id).first()
    if resume and resume.file_path and os.path.exists(resume.file_path):
        try:
            os.remove(resume.file_path)
        except OSError:
            pass
            
    db.delete(candidate)
    db.commit()
    return {"message": "Candidate deleted successfully."}


@router.get("/{candidate_id}", response_model=CandidateDetailResponse)
def read_candidate(
    candidate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    candidate = get_candidate_or_404(db, candidate_id)
    response = CandidateDetailResponse.model_validate(candidate)
    if candidate.creator:
        response.created_by_name = candidate.creator.name or candidate.creator.email
    return response


def _refresh_candidate_interviews(db: Session, candidate: Candidate) -> list:
    interviews = (
        db.query(Interview)
        .filter(Interview.candidate_id == candidate.id)
        .order_by(Interview.scheduled_at.desc())
        .all()
    )
    changed = [lifecycle.refresh_status(db, i) for i in interviews]
    if any(changed):
        commit_or_conflict(db)
    return interviews


@router.get("/{candidate_id}/interviews", response_model=InterviewListResponse)
def read_candidate_interviews(
    candidate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    candidate = get_candidate_or_404(db, candidate_id)
    principal = Principal(role="hr", user=current_user)
    items = [to_response(i, principal) for i in _refresh_candidate_interviews(db, candidate)]
    return {"items": items, "total": len(items)}


@router.post("/{candidate_id}/interviews", response_model=InterviewCreatedResponse, status_code=status.HTTP_201_CREATED)
def create_candidate_interview(
    candidate_id: str,
    payload: InterviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "hr":
        raise HTTPException(status_code=403, detail="Only HR users can request interviews.")
    candidate = get_candidate_or_404(db, candidate_id)

    now = lifecycle.utcnow()
    if payload.instant:
        scheduled_at = now
    else:
        scheduled_at = payload.scheduled_at.astimezone(timezone.utc)
        if scheduled_at < now - timedelta(minutes=5):
            raise HTTPException(status_code=400, detail="Interview time must be in the future.")
        if scheduled_at > now + timedelta(days=MAX_SCHEDULE_AHEAD_DAYS):
            raise HTTPException(status_code=400, detail=f"Interviews can be scheduled at most {MAX_SCHEDULE_AHEAD_DAYS} days ahead.")

    active = [i for i in _refresh_candidate_interviews(db, candidate) if i.status in ACTIVE_INTERVIEW_STATUSES]
    if active:
        raise HTTPException(
            status_code=409,
            detail="This candidate already has an active interview. Cancel or complete it before requesting another.",
        )

    interview_id = uuid.uuid4()
    interview = Interview(
        id=interview_id,
        candidate_id=candidate.id,
        interviewer_id=current_user.id,
        scheduled_at=scheduled_at,
        duration_minutes=payload.duration_minutes,
        is_instant=payload.instant,
        status="request_pending",
        invitation_message=payload.message,
        video_provider="livekit",
        video_room_id=f"candidatelens-{interview_id}",
    )
    token = lifecycle.issue_invitation_token(interview)
    interview.invitation_expires_at = lifecycle.join_closes_at(interview)
    db.add(interview)
    lifecycle.record_event(
        db, interview, "request_created", "hr", current_user.id,
        details={"scheduled_at": scheduled_at.isoformat(), "instant": payload.instant},
    )
    try:
        db.commit()
    except IntegrityError:
        # Lost a race with a concurrent request for the same candidate.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This candidate already has an active interview. Cancel or complete it before requesting another.",
        )
    db.refresh(interview)

    base = to_response(interview, Principal(role="hr", user=current_user))
    return InterviewCreatedResponse(
        **base.model_dump(),
        invitation_url=lifecycle.invitation_url(interview, token),
        email_sent=False,
        notification_detail="No email provider is configured. Copy the invitation link and share it with the candidate.",
    )
