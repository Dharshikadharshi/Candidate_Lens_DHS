import uuid
from sqlalchemy import Column, String, Integer, Text, Boolean, DateTime, ForeignKey, JSON, CheckConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func, text
from app.db.database import Base

# Persisted lifecycle states. "scheduled" and "ready" are derived from an
# accepted interview's time window (see app/services/interviews.py).
INTERVIEW_STATUSES = (
    "request_pending",
    "accepted",
    "declined",
    "in_progress",
    "completed",
    "cancelled",
    "expired",
    "failed",
)
ACTIVE_INTERVIEW_STATUSES = ("request_pending", "accepted", "in_progress")
_ACTIVE_PREDICATE = "status IN ('" + "','".join(ACTIVE_INTERVIEW_STATUSES) + "')"


class Interview(Base):
    __tablename__ = "interviews"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    interviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    is_instant = Column(Boolean, default=False, nullable=False)
    status = Column(String, default="request_pending", nullable=False)
    invitation_message = Column(Text)
    invitation_token_hash = Column(String(64), unique=True)
    invitation_expires_at = Column(DateTime(timezone=True))

    video_provider = Column(String, default="livekit", nullable=False)
    video_room_id = Column(String, unique=True)

    notes = Column(Text)
    started_at = Column(DateTime(timezone=True))
    ended_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Optimistic concurrency: every UPDATE is guarded by "WHERE version = <read version>".
    version = Column(Integer, nullable=False, default=1)
    __mapper_args__ = {"version_id_col": version}

    __table_args__ = (
        CheckConstraint(
            "status IN ('" + "','".join(INTERVIEW_STATUSES) + "')",
            name="ck_interviews_status",
        ),
        CheckConstraint("duration_minutes > 0", name="ck_interviews_duration_positive"),
        Index("ix_interviews_candidate_status", "candidate_id", "status"),
        Index("ix_interviews_interviewer_scheduled", "interviewer_id", "scheduled_at"),
        # At most one active interview per candidate, enforced by the database.
        Index(
            "uq_interviews_one_active_per_candidate",
            "candidate_id",
            unique=True,
            postgresql_where=text(_ACTIVE_PREDICATE),
            sqlite_where=text(_ACTIVE_PREDICATE),
        ),
    )

    candidate = relationship("Candidate", back_populates="interviews")
    interviewer = relationship("User")
    events = relationship(
        "InterviewEvent",
        back_populates="interview",
        cascade="all, delete-orphan",
        order_by="InterviewEvent.created_at",
    )


class InterviewEvent(Base):
    __tablename__ = "interview_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String, nullable=False)
    actor_type = Column(String, nullable=False)  # hr | candidate | system
    actor_id = Column(UUID(as_uuid=True))
    details = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    interview = relationship("Interview", back_populates="events")


class InterviewPresence(Base):
    """Last heartbeat per participant role. Used to stop the interview continuing without HR."""
    __tablename__ = "interview_presence"

    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), primary_key=True)
    role = Column(String, primary_key=True)  # hr | candidate
    last_seen_at = Column(DateTime(timezone=True), nullable=False)
