"""Interview lifecycle rules. The backend is the single source of truth for state.

    request_pending -> accepted -> (scheduled | ready) -> in_progress -> completed
    request_pending -> declined | cancelled | expired
    accepted        -> declined | cancelled | expired

"scheduled" and "ready" are not stored: an accepted interview is "ready" once
its join window opens (scheduled_at - INTERVIEW_JOIN_EARLY_MINUTES).
"""
import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.interview import Interview, InterviewEvent, InterviewPresence

logger = logging.getLogger(__name__)

TERMINAL_STATUSES = ("declined", "completed", "cancelled", "expired", "failed")
# Sessions ended by these reasons are incomplete: no automatic report; HR can schedule a re-interview.
EARLY_END_REASONS = ("interviewer_left", "interviewer_disconnected")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_aware(value: Optional[datetime]) -> Optional[datetime]:
    """SQLite drops tzinfo; values are always stored in UTC."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_invitation_token(interview: Interview) -> str:
    token = secrets.token_urlsafe(32)
    interview.invitation_token_hash = hash_token(token)
    return token


def token_matches(interview: Interview, token: str) -> bool:
    if not interview.invitation_token_hash or not token:
        return False
    return hmac.compare_digest(interview.invitation_token_hash, hash_token(token))


def invitation_url(interview: Interview, token: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/interviews/{interview.id}/invitation?token={token}"


def join_opens_at(interview: Interview) -> datetime:
    return as_aware(interview.scheduled_at) - timedelta(minutes=settings.INTERVIEW_JOIN_EARLY_MINUTES)


def join_closes_at(interview: Interview) -> datetime:
    return as_aware(interview.scheduled_at) + timedelta(
        minutes=interview.duration_minutes + settings.INTERVIEW_GRACE_MINUTES
    )


def in_join_window(interview: Interview, now: Optional[datetime] = None) -> bool:
    now = now or utcnow()
    return join_opens_at(interview) <= now <= join_closes_at(interview)


def display_status(interview: Interview) -> str:
    if interview.status == "accepted":
        return "ready" if in_join_window(interview) else "scheduled"
    return interview.status


def can_join(interview: Interview, role: str) -> bool:
    if not in_join_window(interview):
        return False
    if interview.status in ("accepted", "in_progress"):
        return True
    # For an instant interview, HR may wait in the room while the candidate responds.
    return role == "hr" and interview.is_instant and interview.status == "request_pending"


def record_event(
    db: Session,
    interview: Interview,
    event_type: str,
    actor_type: str,
    actor_id=None,
    details: Optional[dict] = None,
) -> None:
    db.add(InterviewEvent(
        interview_id=interview.id,
        event_type=event_type,
        actor_type=actor_type,
        actor_id=actor_id,
        details=details,
    ))
    logger.info("interview %s: %s by %s", interview.id, event_type, actor_type)


def touch_presence(db: Session, interview: Interview, role: str) -> None:
    row = db.get(InterviewPresence, (interview.id, role))
    if row is None:
        db.add(InterviewPresence(interview_id=interview.id, role=role, last_seen_at=utcnow()))
    else:
        row.last_seen_at = utcnow()


def interviewer_last_seen(db: Session, interview: Interview) -> Optional[datetime]:
    row = db.get(InterviewPresence, (interview.id, "hr"))
    return as_aware(row.last_seen_at) if row else None


def interviewer_present(db: Session, interview: Interview) -> bool:
    seen = interviewer_last_seen(db, interview)
    return seen is not None and utcnow() - seen <= timedelta(seconds=settings.INTERVIEWER_ABSENT_SECONDS)


def end_session(db: Session, interview: Interview, reason: str, actor_type: str, actor_id=None):
    """End an in-progress session. Returns (plan, ai_completed). Caller commits and closes the room."""
    from app.services import ai_interview  # local import: ai_interview depends on this module

    interview.status = "completed"
    interview.ended_at = utcnow()
    record_event(db, interview, "ended", actor_type, actor_id, details={"reason": reason})
    plan = ai_interview.get_plan(db, interview.id)
    ai_completed = plan is not None and plan.status == "active" and ai_interview.complete_plan(
        plan, "interview_ended" if reason == "completed" else reason)
    return plan, ai_completed


def end_reason(interview: Interview) -> Optional[str]:
    for event in reversed(interview.events):
        if event.event_type in ("ended", "auto_closed"):
            return (event.details or {}).get("reason", "completed")
    return None


def refresh_status(db: Session, interview: Interview) -> bool:
    """Apply time-based transitions lazily. Returns True if the row changed."""
    now = utcnow()
    if interview.status == "in_progress":
        seen = interviewer_last_seen(db, interview)
        if seen is not None and now - seen > timedelta(seconds=settings.INTERVIEWER_GONE_SECONDS):
            end_session(db, interview, "interviewer_disconnected", "system")
            return True
    if now <= join_closes_at(interview):
        return False
    if interview.status in ("request_pending", "accepted"):
        interview.status = "expired"
        record_event(db, interview, "expired", "system")
        return True
    if interview.status == "in_progress":
        interview.status = "completed"
        interview.ended_at = now
        record_event(db, interview, "auto_closed", "system", details={"reason": "join window closed"})
        return True
    return False
