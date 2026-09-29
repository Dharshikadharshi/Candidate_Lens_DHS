import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from fastapi.responses import Response

from app.api.deps import get_db, get_current_user, get_ai_client, get_session_factory
from app.models.user import User
from app.models.candidate import Candidate
from app.models.resume_validation import ResumeValidationReport
from app.schemas.resume_validation import (
    ResumeValidationCreate,
    ResumeValidationResponse,
    ResumeValidationHistoryResponse
)
from app.services.resume_validation import request_validation, run_resume_validation

router = APIRouter()

def get_candidate_or_404(db: Session, candidate_id: str, current_user: User) -> Candidate:
    try:
        c_id = uuid.UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid candidate ID format")
    candidate = db.query(Candidate).filter(Candidate.id == c_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    print(f"DEBUG: current_user.id={current_user.id} ({type(current_user.id)})")
    print(f"DEBUG: current_user.email={current_user.email}")
    print(f"DEBUG: current_user.role={current_user.role}")
    print(f"DEBUG: candidate.id={candidate.id}")
    print(f"DEBUG: candidate.created_by={candidate.created_by} ({type(candidate.created_by)})")
    print(f"DEBUG: current_user.id == candidate.created_by -> {current_user.id == candidate.created_by}")
    
    if candidate.created_by != current_user.id:
        print(f"DEBUG: 403 BRANCH TRIGGERED - OWNERSHIP CHECK")
        raise HTTPException(status_code=403, detail="Not authorized to access this candidate.")
    return candidate

@router.post("/candidates/{candidate_id}/resume-validation", response_model=ResumeValidationResponse)
def start_validation(
    candidate_id: str,
    background_tasks: BackgroundTasks,
    payload: Optional[ResumeValidationCreate] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ai_client = Depends(get_ai_client),
    session_factory = Depends(get_session_factory)
):
    if current_user.role != "hr":
        raise HTTPException(status_code=403, detail="Not authorized.")
        
    candidate = get_candidate_or_404(db, candidate_id, current_user)
        
    try:
        target_role = payload.target_role if payload else None
        report = request_validation(db, candidate, current_user.id, target_role_override=target_role)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    background_tasks.add_task(run_resume_validation, session_factory, ai_client, report.id)
    return report

@router.get("/candidates/{candidate_id}/resume-validation", response_model=ResumeValidationHistoryResponse)
def get_validation_history(
    candidate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "hr":
        print(f"DEBUG: 403 BRANCH TRIGGERED - ROLE CHECK. current_user.role={current_user.role}")
        raise HTTPException(status_code=403, detail="Not authorized.")
        
    candidate = get_candidate_or_404(db, candidate_id, current_user)
    
    reports = db.query(ResumeValidationReport).filter(ResumeValidationReport.candidate_id == candidate.id).order_by(ResumeValidationReport.created_at.desc()).all()
    return {"items": reports, "total": len(reports)}

@router.get("/resume-validation/{report_id}", response_model=ResumeValidationResponse)
def get_validation_report(
    report_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "hr":
        raise HTTPException(status_code=403, detail="Not authorized.")
        
    try:
        r_id = uuid.UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid report ID format")
        
    report = db.query(ResumeValidationReport).filter(ResumeValidationReport.id == r_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
        
    if report.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to access this report.")
        
    return report

@router.post("/resume-validation/{report_id}/regenerate", response_model=ResumeValidationResponse)
def regenerate_validation(
    report_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ai_client = Depends(get_ai_client),
    session_factory = Depends(get_session_factory)
):
    if current_user.role != "hr":
        raise HTTPException(status_code=403, detail="Not authorized.")
        
    try:
        r_id = uuid.UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid report ID format")
        
    old_report = db.query(ResumeValidationReport).filter(ResumeValidationReport.id == r_id).first()
    if not old_report:
        raise HTTPException(status_code=404, detail="Report not found")
        
    if old_report.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to access this report.")
        
    candidate = db.query(Candidate).filter(Candidate.id == old_report.candidate_id).first()
    
    try:
        new_report = request_validation(db, candidate, current_user.id, target_role_override=old_report.target_role)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    background_tasks.add_task(run_resume_validation, session_factory, ai_client, new_report.id)
    return new_report

@router.get("/resume-validation/{report_id}/download")
def download_validation_report(
    report_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "hr":
        raise HTTPException(status_code=403, detail="Not authorized.")
        
    try:
        r_id = uuid.UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid report ID format")
        
    report = db.query(ResumeValidationReport).filter(ResumeValidationReport.id == r_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
        
    if report.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to access this report.")
        
    if report.validation_status != "completed":
        raise HTTPException(status_code=400, detail="Cannot download report unless validation is completed.")
        
    candidate = db.query(Candidate).filter(Candidate.id == report.candidate_id).first()
    
    report_dict = report.__dict__.copy()
    
    # Add extra candidate/resume info for PDF presentation
    resume_filename = "No resume"
    if candidate and candidate.resume:
        resume_filename = candidate.resume.original_filename
        
    report_dict["candidate_info"] = {
        "candidate_name": candidate.full_name if candidate else "Unknown Candidate"
    }
    report_dict["resume_filename"] = resume_filename
    
    try:
        from app.services.report_pdf import render_resume_validation_pdf
        pdf_bytes = render_resume_validation_pdf(report_dict)
    except Exception as e:
        import logging
        logging.getLogger(__name__).exception("Failed to render PDF for report %s", report.id)
        raise HTTPException(status_code=500, detail="Failed to generate PDF.")
        
    headers = {
        "Content-Disposition": f'attachment; filename="validation_report_{candidate.full_name.replace(" ", "_") if candidate else "report"}.pdf"'
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
