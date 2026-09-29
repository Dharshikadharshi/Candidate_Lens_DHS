import uuid
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")

class ResumeValidationReport(Base):
    __tablename__ = "resume_validation_reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False, index=True)
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL"))
    target_role = Column(String, nullable=False)
    validation_status = Column(String, nullable=False, default="processing")  # processing | completed | failed
    overall_score = Column(Integer)
    category_scores = Column(JSONType)
    detailed_findings = Column(JSONType)
    suggested_questions = Column(JSONType)
    verification_summary = Column(JSONType)
    validation_pipeline = Column(JSONType)
    evidence = Column(JSONType)
    inconsistencies = Column(JSONType)
    missing_information = Column(JSONType)
    github_verification = Column(JSONType)
    linkedin_verification = Column(JSONType)
    project_verification = Column(JSONType)
    rubric_version = Column(String)
    model_name = Column(String)
    prompt_version = Column(String)
    error = Column(Text)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    candidate = relationship("Candidate")
    resume = relationship("Resume")
    creator = relationship("User")
