"""Pydantic schemas for the Resume Validation API."""
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict


class ValidationStartRequest(BaseModel):
    target_role: Optional[str] = None
    force: bool = False


class ValidationReportSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    candidate_id: uuid.UUID
    resume_filename: Optional[str] = None
    target_role: str
    status: str
    overall_score: Optional[float] = None
    version: int
    created_at: Optional[datetime] = None


class ValidationReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    candidate_id: uuid.UUID
    resume_id: Optional[uuid.UUID] = None
    resume_filename: Optional[str] = None
    target_role: str
    experience_level: Optional[str] = None
    status: str
    overall_score: Optional[float] = None
    category_scores: Optional[Dict[str, Any]] = None
    detailed_findings: Optional[List[Dict[str, Any]]] = None
    skills_evidence_map: Optional[List[Dict[str, Any]]] = None
    suggested_questions: Optional[List[str]] = None
    summary: Optional[str] = None
    error: Optional[str] = None
    rubric_version: str
    model_name: Optional[str] = None
    prompt_version: Optional[str] = None
    version: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    has_resume: bool = True
