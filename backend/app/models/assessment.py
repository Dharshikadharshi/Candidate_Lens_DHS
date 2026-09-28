"""AI-assisted assessment tables (Phase 3).

Existing tables (users, candidates, resumes, interviews) are referenced, never altered.
Child rows are removed by ON DELETE CASCADE when an interview/candidate is deleted.
"""
import uuid
from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


class ResumeAnalysis(Base):
    __tablename__ = "resume_analyses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False, index=True)
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL"))
    # sha256 of the file bytes: re-uploading a resume makes older analyses stale.
    resume_fingerprint = Column(String(64))
    resume_filename = Column(String)
    status = Column(String, nullable=False, default="processing")  # processing | completed | failed
    extracted_profile = Column(JSONType)
    extracted_claims = Column(JSONType)
    text_stats = Column(JSONType)
    error = Column(Text)
    model_name = Column(String)
    prompt_version = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class InterviewQuestionPlan(Base):
    __tablename__ = "interview_question_plans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False, unique=True)
    resume_analysis_id = Column(UUID(as_uuid=True), ForeignKey("resume_analyses.id", ondelete="SET NULL"))
    role = Column(String, nullable=False)
    role_profile_key = Column(String)
    difficulty = Column(String, nullable=False)
    configuration = Column(JSONType, nullable=False)
    rubric_version = Column(String, nullable=False)
    prompt_version = Column(String)
    model_name = Column(String)
    # generating | ready | failed | active | completed
    status = Column(String, nullable=False, default="generating")
    error = Column(Text)
    current_question_id = Column(UUID(as_uuid=True))  # the single active question (server-controlled)
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    completion_reason = Column(String)
    ai_disclosure_ack_at = Column(DateTime(timezone=True))
    transcription_consent_at = Column(DateTime(timezone=True))
    transcription_consent = Column(Boolean)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Optimistic concurrency + cheap change detection (used as the polling ETag).
    version = Column(Integer, nullable=False, default=1)
    __mapper_args__ = {"version_id_col": version}

    interview = relationship("Interview")
    questions = relationship(
        "InterviewQuestion",
        back_populates="plan",
        order_by="(InterviewQuestion.sequence_number, InterviewQuestion.follow_up_index)",
        cascade="all, delete-orphan",
    )


class InterviewQuestion(Base):
    __tablename__ = "interview_questions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("interview_question_plans.id", ondelete="CASCADE"), nullable=False)
    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence_number = Column(Integer, nullable=False)
    follow_up_index = Column(Integer, nullable=False, default=0)  # 0 = main question
    is_follow_up = Column(Boolean, nullable=False, default=False)
    parent_question_id = Column(UUID(as_uuid=True), ForeignKey("interview_questions.id", ondelete="CASCADE"))
    question_category = Column(String, nullable=False)
    text = Column(Text, nullable=False)
    topic = Column(String)
    source_claim = Column(JSONType)       # {claim_id, claim, source_text, page, section}
    expected_evidence = Column(JSONType)  # hidden from the candidate
    dimensions = Column(JSONType, nullable=False)
    difficulty = Column(String)
    # planned | active | answered | evaluating | evaluated | evaluation_failed | skipped
    status = Column(String, nullable=False, default="planned")
    skip_reason = Column(Text)
    next_action = Column(JSONType)  # traceable AI/rules decision taken after this question
    rubric_version = Column(String, nullable=False)
    asked_at = Column(DateTime(timezone=True))
    handled_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("plan_id", "sequence_number", "follow_up_index", name="uq_question_sequence"),
    )

    plan = relationship("InterviewQuestionPlan", back_populates="questions")
    answer = relationship("InterviewAnswer", uselist=False, back_populates="question")


class InterviewAnswer(Base):
    __tablename__ = "interview_answers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    question_id = Column(UUID(as_uuid=True), ForeignKey("interview_questions.id", ondelete="CASCADE"), nullable=False, unique=True)
    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String, nullable=False, default="draft")  # draft | submitted
    capture_method = Column(String, nullable=False)  # typed | voice
    transcript_text = Column(Text)   # verbatim speech-to-text output
    answer_text = Column(Text)       # text that was submitted and evaluated
    transcript_edited = Column(Boolean, nullable=False, default=False)
    # not_applicable | processing | completed | empty | failed
    transcription_status = Column(String, nullable=False, default="not_applicable")
    transcription_error = Column(Text)
    audio_duration_seconds = Column(Float)
    transcript_flagged = Column(Boolean, nullable=False, default=False)
    transcript_flag_note = Column(Text)
    transcript_flagged_by = Column(String)
    # not_started | in_progress | completed | failed
    evaluation_status = Column(String, nullable=False, default="not_started")
    evaluation_error = Column(Text)
    evaluation_attempts = Column(Integer, nullable=False, default=0)
    evaluation_started_at = Column(DateTime(timezone=True))
    transcript_quality = Column(String)
    answer_addresses_question = Column(Boolean)
    evidence_sufficient = Column(Boolean)
    missing_evidence = Column(JSONType)
    idempotency_key = Column(String(64))
    submitted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    question = relationship("InterviewQuestion", back_populates="answer")
    evaluations = relationship("AnswerEvaluation", order_by="AnswerEvaluation.evaluation_version")


class AnswerEvaluation(Base):
    """Append-only: a re-evaluation or HR correction adds a higher evaluation_version."""
    __tablename__ = "answer_evaluations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    answer_id = Column(UUID(as_uuid=True), ForeignKey("interview_answers.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(UUID(as_uuid=True), ForeignKey("interview_questions.id", ondelete="CASCADE"), nullable=False)
    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False, index=True)
    dimension = Column(String, nullable=False)
    evaluation_version = Column(Integer, nullable=False)
    source = Column(String, nullable=False, default="ai")  # ai | hr
    evidence_status = Column(String, nullable=False)  # scored | insufficient_data | needs_review
    score = Column(Integer)  # 1-5, only when evidence_status == "scored"
    rubric_version = Column(String, nullable=False)
    rationale = Column(Text)
    evidence_excerpt = Column(Text)
    excerpt_verified = Column(Boolean)
    confidence_label = Column(String)  # high | medium | low
    review_status = Column(String, nullable=False, default="not_required")  # not_required | needs_review | reviewed
    model_name = Column(String)
    prompt_version = Column(String)
    reviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("answer_id", "dimension", "evaluation_version", name="uq_evaluation_version"),
    )


class InterviewAssessmentReport(Base):
    __tablename__ = "interview_assessment_reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False)
    report_version = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default="generating")  # generating | ready | partial | failed
    candidate_info = Column(JSONType)
    executive_summary = Column(JSONType)
    dimension_scores = Column(JSONType)
    aggregate = Column(JSONType)
    question_analysis = Column(JSONType)
    strengths = Column(JSONType)
    areas_for_follow_up = Column(JSONType)
    suggested_questions = Column(JSONType)
    claim_verification = Column(JSONType)
    limitations = Column(JSONType)
    rubric_version = Column(String)
    model_name = Column(String)
    prompt_version = Column(String)
    error = Column(Text)
    generated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Human review, kept apart from every AI-generated field above.
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    reviewer_name = Column(String)
    reviewed_at = Column(DateTime(timezone=True))
    hr_notes = Column(Text)
    hr_clarifications = Column(Text)
    hr_next_step = Column(String)
    hr_decision = Column(Text)

    version = Column(Integer, nullable=False, default=1)
    __mapper_args__ = {"version_id_col": version}

    __table_args__ = (
        UniqueConstraint("interview_id", "report_version", name="uq_report_version"),
    )


class AIUsageEvent(Base):
    __tablename__ = "ai_usage_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # SET NULL so cost history survives candidate/interview deletion.
    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="SET NULL"))
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="SET NULL"))
    provider = Column(String, nullable=False)
    model = Column(String, nullable=False)
    operation = Column(String, nullable=False)
    input_tokens = Column(Integer)
    output_tokens = Column(Integer)
    audio_duration_seconds = Column(Float)
    status = Column(String, nullable=False)  # success | error
    error_type = Column(String)
    latency_ms = Column(Integer)
    estimated_cost = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_ai_usage_interview", "interview_id"),
        Index("ix_ai_usage_created", "created_at"),
    )
