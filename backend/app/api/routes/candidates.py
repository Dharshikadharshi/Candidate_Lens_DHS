from typing import Any, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import get_db, get_current_user
from app.models.candidate import Candidate
from app.models.user import User
from app.schemas.candidate import CandidateListResponse

router = APIRouter()

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

    # Manually format response to match schema structure
    # since we don't have a separate Resume table yet
    response_items = []
    for item in items:
        candidate_dict = item.__dict__
        if item.resume_id:
            candidate_dict["resume"] = {
                "id": item.resume_id,
                "file_name": item.resume_file_name or "resume.pdf"
            }
        response_items.append(candidate_dict)

    return {"items": response_items, "total": total}
