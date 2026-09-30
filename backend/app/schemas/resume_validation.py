from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, field_validator
import uuid

class CategoryScore(BaseModel):
    category: str
    score: int
    maximum_score: int
    reasoning_summary: str

class ValidationFinding(BaseModel):
    category: str
    score: int
    maximum_score: int
    finding_description: str
    relevant_resume_excerpt: Optional[str] = None
    resume_page_or_section: Optional[str] = None
    reasoning_summary: str
    recommended_action: Optional[str] = None
    review_status: str

class SuggestedQuestion(BaseModel):
    category: str
    priority: str
    question: str
    rationale: str

class VerificationSummary(BaseModel):
    contact: str
    education: str
    experience: str
    skills: str
    projects: str
    certifications: str
    github: str
    linkedin: str
    portfolio: str

class EvidenceItem(BaseModel):
    category: str
    claim: str
    evidence: str
    source: str
    status: str

class InconsistencyItem(BaseModel):
    type: str
    description: str
    severity: str

class MissingInfoItem(BaseModel):
    item: str
    status: str

class ProjectVerification(BaseModel):
    project_name: str
    description: str
    technologies: List[str]
    date: str
    claimed_features: List[str]
    claimed_frameworks: List[str]
    claimed_models: List[str]
    claimed_deployment: List[str]

class ResumeValidationCreate(BaseModel):
    target_role: Optional[str] = None

class ResumeValidationResponse(BaseModel):
    id: uuid.UUID
    candidate_id: uuid.UUID
    resume_id: Optional[uuid.UUID] = None
    target_role: str
    validation_status: str
    overall_score: Optional[int] = None
    category_scores: Optional[List[CategoryScore]] = None
    detailed_findings: Optional[List[ValidationFinding]] = None
    suggested_questions: Optional[List[SuggestedQuestion]] = None
    verification_summary: Optional[dict] = None
    validation_pipeline: Optional[List[dict]] = None
    evidence: Optional[List[dict]] = None
    inconsistencies: Optional[List[dict]] = None
    missing_information: Optional[List[dict]] = None
    github_verification: Optional[dict] = None
    linkedin_verification: Optional[dict] = None
    leetcode_verification: Optional[dict] = None
    hackerrank_verification: Optional[dict] = None
    project_verification: Optional[List[dict]] = None
    rubric_version: Optional[str] = None
    model_name: Optional[str] = None
    prompt_version: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    
    @field_validator('suggested_questions', mode='before')
    @classmethod
    def normalize_suggested_questions_list(cls, v):
        from app.services.resume_validation import normalize_suggested_questions
        return normalize_suggested_questions(v) if v else v
    
    class Config:
        from_attributes = True

class ResumeValidationHistoryResponse(BaseModel):
    items: List[ResumeValidationResponse]
    total: int
