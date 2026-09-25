from typing import Any, Optional
import os
import uuid
import shutil
from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.api.deps import get_db, get_current_user
from app.models.candidate import Candidate
from app.models.user import User
from app.models.resume import Resume
from app.schemas.candidate import CandidateListResponse, ResumeInfo, CandidateCreate, CandidateResponse, CandidateStatusUpdate

router = APIRouter()

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
