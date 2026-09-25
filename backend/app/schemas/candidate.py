from pydantic import BaseModel, EmailStr
from typing import Optional, List
from uuid import UUID
from datetime import datetime

class ResumeInfo(BaseModel):
    id: UUID
    original_filename: str
    file_type: str
    file_size: int
    uploaded_at: datetime
    
    class Config:
        from_attributes = True

class CandidateBase(BaseModel):
    full_name: str
    email: EmailStr
    phone: Optional[str] = None
    target_role: str
    status: Optional[str] = "awaiting_assessment"

class CandidateCreate(CandidateBase):
    pass

class CandidateStatusUpdate(BaseModel):
    status: str

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
