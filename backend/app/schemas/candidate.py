from pydantic import BaseModel, EmailStr
from typing import Optional, List
from uuid import UUID
from datetime import datetime

class ResumeInfo(BaseModel):
    id: str
    file_name: str

class CandidateBase(BaseModel):
    full_name: str
    email: EmailStr
    phone: Optional[str] = None
    target_role: str
    status: Optional[str] = "awaiting_assessment"

class CandidateCreate(CandidateBase):
    resume_id: Optional[str] = None
    resume_file_name: Optional[str] = None

class CandidateResponse(CandidateBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    resume: Optional[ResumeInfo] = None

    class Config:
        from_attributes = True

class CandidateListResponse(BaseModel):
    items: List[CandidateResponse]
    total: int
