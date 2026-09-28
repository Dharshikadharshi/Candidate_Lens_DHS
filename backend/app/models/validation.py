"""Resume validation database model."""
import uuid
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


class ResumeValidationReport(Base):
    __tablename__ = "resume_validation_reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False, index=True)
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True, index=True)
    resume_fingerprint = Column(String(64), nullable=True)
    resume_filename = Column(String, nullable=True)
    target_role = Column(String, nullable=False)
    experience_level = Column(String, nullable=True, default="mid")

    status = Column(String, nullable=False, default="processing")  # processing | completed | failed
    overall_score = Column(Float, nullable=True)  # 0.0 - 100.0

    # JSON structures
    category_scores = Column(JSONType, nullable=True)
    # {
    #   "completeness": {"score": 18, "max_score": 20, "summary": "..."},
    #   "role_relevance": {"score": 22, "max_score": 25, "summary": "..."},
    #   "skill_evidence": {"score": 21, "max_score": 25, "summary": "..."},
    #   "consistency": {"score": 14, "max_score": 15, "summary": "..."},
    #   "readability": {"score": 13, "max_score": 15, "summary": "..."}
    # }

    detailed_findings = Column(JSONType, nullable=True)
    # list of findings: category, score, max_score, finding_description, relevant_excerpt,
    # section_or_page, reasoning, recommended_action, review_status

    skills_evidence_map = Column(JSONType, nullable=True)
    # list of skill statuses: skill, status ("supported" | "unsupported" | "not_mentioned" | "indeterminate"),
    # evidence_excerpt, section

    suggested_questions = Column(JSONType, nullable=True)
    # list of suggested interview follow-up questions

    summary = Column(Text, nullable=True)
    error = Column(Text, nullable=True)

    rubric_version = Column(String, nullable=False, default="rv-1.0")
    model_name = Column(String, nullable=True)
    prompt_version = Column(String, nullable=True, default="resume-validation-v1")
    version = Column(Integer, nullable=False, default=1)

    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    candidate = relationship("Candidate", back_populates="validation_reports")
    creator = relationship("User")
