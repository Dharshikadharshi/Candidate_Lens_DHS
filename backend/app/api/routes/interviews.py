import logging
import uuid
from dataclasses import dataclass
from typing import Optional, List

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.api.deps import get_ai_client, get_db, get_current_user, get_session_factory, optional_oauth2_scheme
from app.models.interview import Interview, InterviewEvent
from app.models.user import User
from app.schemas.interview import (
    InterviewResponse,
    InterviewEndRequest,
    InterviewResponseUpdate,
    InterviewNotesUpdate,
    InterviewEventResponse,
    InvitationLinkResponse,
    JoinRoomResponse,
    VersionedRequest,
)
from app.services import interviews as lifecycle
from app.services import video

logger = logging.getLogger(__name__)

router = APIRouter()

CONFLICT_DETAIL = "This interview was changed elsewhere. Reload to see the latest state."


@dataclass
class Principal:
    role: str  # "hr" | "candidate"
    user: Optional[User] = None

    def is_interviewer(self, interview: Interview) -> bool:
        return self.role == "hr" and self.user is not None and self.user.id == interview.interviewer_id


def commit_or_conflict(db: Session) -> None:
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=CONFLICT_DETAIL)


def check_version(interview: Interview, version: Optional[int]) -> None:
    if version is not None and version != interview.version:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=CONFLICT_DETAIL)


def load_interview(db: Session, interview_id: str) -> Interview:
    try:
        i_id = uuid.UUID(interview_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid interview ID format")
    interview = db.query(Interview).filter(Interview.id == i_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    was_live = interview.status == "in_progress"
    if lifecycle.refresh_status(db, interview):
        commit_or_conflict(db)
        db.refresh(interview)
        if was_live and interview.status == "completed":
            video.close_room(interview.video_room_id)  # interviewer gone: disconnect the candidate too
    return interview


def to_response(interview: Interview, principal: Principal) -> InterviewResponse:
    is_interviewer = principal.is_interviewer(interview)
    joinable = lifecycle.can_join(interview, principal.role) and (principal.role == "candidate" or is_interviewer)
    interviewer = interview.interviewer
    return InterviewResponse(
        id=interview.id,
        candidate_id=interview.candidate_id,
        candidate_name=interview.candidate.full_name,
        target_role=interview.candidate.target_role,
        interviewer_id=interview.interviewer_id,
        interviewer_name=(interviewer.name or interviewer.email) if interviewer else None,
        scheduled_at=lifecycle.as_aware(interview.scheduled_at),
        duration_minutes=interview.duration_minutes,
        is_instant=interview.is_instant,
        status=interview.status,
        display_status=lifecycle.display_status(interview),
        invitation_message=interview.invitation_message,
        invitation_expires_at=lifecycle.as_aware(interview.invitation_expires_at),
        join_opens_at=lifecycle.join_opens_at(interview),
        join_closes_at=lifecycle.join_closes_at(interview),
        can_join=joinable,
        viewer_role=principal.role,
        is_interviewer=is_interviewer,
        video_provider=interview.video_provider,
        video_room_id=interview.video_room_id if joinable else None,
        notes=interview.notes if is_interviewer else None,
        started_at=lifecycle.as_aware(interview.started_at),
        ended_at=lifecycle.as_aware(interview.ended_at),
        created_at=lifecycle.as_aware(interview.created_at),
        updated_at=lifecycle.as_aware(interview.updated_at),
        version=interview.version,
        end_reason=lifecycle.end_reason(interview),
    )


def get_interview_context(
    interview_id: str,
    db: Session = Depends(get_db),
    bearer_token: Optional[str] = Depends(optional_oauth2_scheme),
    invitation_token: Optional[str] = Header(None, alias="X-Invitation-Token"),
) -> tuple:
    """Resolve who is calling: the invited candidate (invitation token) or the assigned interviewer (JWT)."""
    interview = load_interview(db, interview_id)
    if invitation_token:
        if lifecycle.token_matches(interview, invitation_token):
            return interview, Principal(role="candidate")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This invitation link is not valid for this interview.")
    if bearer_token:
        user = get_current_user(db=db, token=bearer_token)
        principal = Principal(role="hr", user=user)
        if principal.is_interviewer(interview):
            return interview, principal
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the assigned interviewer can access this interview.")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_role(principal: Principal, role: str) -> None:
    if principal.role != role:
        who = "the invited candidate" if role == "candidate" else "the assigned interviewer"
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Only {who} can perform this action.")


@router.get("/{interview_id}", response_model=InterviewResponse)
def read_interview(ctx: tuple = Depends(get_interview_context)):
    interview, principal = ctx
    return to_response(interview, principal)


@router.patch("/{interview_id}/response", response_model=InterviewResponse)
def respond_to_invitation(
    body: InterviewResponseUpdate,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
):
    interview, principal = ctx
    require_role(principal, "candidate")
    check_version(interview, body.version)

    if body.response == "accept":
        if interview.status == "accepted":
            return to_response(interview, principal)
        if interview.status != "request_pending":
            raise HTTPException(status_code=409, detail=f"This invitation can no longer be accepted (status: {interview.status}).")
        interview.status = "accepted"
        lifecycle.record_event(db, interview, "accepted", "candidate")
    else:
        if interview.status == "declined":
            return to_response(interview, principal)
        if interview.status not in ("request_pending", "accepted"):
            raise HTTPException(status_code=409, detail=f"This invitation can no longer be declined (status: {interview.status}).")
        interview.status = "declined"
        lifecycle.record_event(db, interview, "declined", "candidate")

    commit_or_conflict(db)
    db.refresh(interview)
    return to_response(interview, principal)


@router.patch("/{interview_id}/cancel", response_model=InterviewResponse)
def cancel_interview(
    body: Optional[VersionedRequest] = None,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
):
    interview, principal = ctx
    require_role(principal, "hr")
    check_version(interview, body.version if body else None)
    if interview.status not in ("request_pending", "accepted"):
        raise HTTPException(status_code=409, detail=f"An interview with status '{interview.status}' cannot be cancelled.")

    interview.status = "cancelled"
    lifecycle.record_event(db, interview, "cancelled", "hr", principal.user.id)
    commit_or_conflict(db)
    video.close_room(interview.video_room_id)
    db.refresh(interview)
    return to_response(interview, principal)


@router.post("/{interview_id}/invitation-link", response_model=InvitationLinkResponse)
def regenerate_invitation_link(
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
):
    """Only a hash of the token is stored, so a lost link is replaced rather than re-read."""
    interview, principal = ctx
    require_role(principal, "hr")
    if interview.status not in ("request_pending", "accepted", "in_progress"):
        raise HTTPException(status_code=409, detail=f"No invitation link can be issued for a '{interview.status}' interview.")

    token = lifecycle.issue_invitation_token(interview)
    lifecycle.record_event(db, interview, "invitation_link_regenerated", "hr", principal.user.id)
    commit_or_conflict(db)
    return InvitationLinkResponse(
        invitation_url=lifecycle.invitation_url(interview, token),
        invitation_expires_at=lifecycle.as_aware(interview.invitation_expires_at),
    )


@router.post("/{interview_id}/join", response_model=JoinRoomResponse)
def join_interview_room(
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
):
    interview, principal = ctx
    if not lifecycle.can_join(interview, principal.role):
        if interview.status in lifecycle.TERMINAL_STATUSES:
            detail = f"This interview is {interview.status} and can no longer be joined."
        elif interview.status == "request_pending":
            detail = "The candidate has not accepted this invitation yet."
        else:
            detail = "The interview room is not open yet. You can join 15 minutes before the scheduled time."
        raise HTTPException(status_code=409, detail=detail)

    if principal.role == "hr":
        identity = f"hr-{principal.user.id}"
        display_name = principal.user.name or principal.user.email
    else:
        identity = f"candidate-{interview.candidate_id}"
        display_name = interview.candidate.full_name

    try:
        access = video.create_access_token(
            room_name=interview.video_room_id,
            identity=identity,
            display_name=display_name,
            metadata={"role": principal.role, "interview_id": str(interview.id)},
        )
    except video.VideoProviderNotConfigured as exc:
        logger.warning("Join refused for interview %s: %s", interview.id, exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    lifecycle.record_event(
        db, interview, "join_token_issued", principal.role,
        principal.user.id if principal.user else None,
    )
    commit_or_conflict(db)
    db.refresh(interview)
    return JoinRoomResponse(
        provider=video.PROVIDER_NAME,
        server_url=access.server_url,
        room_name=access.room_name,
        token=access.token,
        identity=access.identity,
        role=principal.role,
        expires_at=access.expires_at,
        interview=to_response(interview, principal),
    )


@router.post("/{interview_id}/start", response_model=InterviewResponse)
def start_interview(
    body: Optional[VersionedRequest] = None,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
):
    interview, principal = ctx
    require_role(principal, "hr")
    if interview.status == "in_progress":
        return to_response(interview, principal)  # idempotent for reconnects
    check_version(interview, body.version if body else None)
    if interview.status != "accepted":
        raise HTTPException(status_code=409, detail=f"An interview with status '{interview.status}' cannot be started.")
    if not lifecycle.in_join_window(interview):
        raise HTTPException(status_code=409, detail="The interview window is not open.")

    interview.status = "in_progress"
    interview.started_at = lifecycle.utcnow()
    lifecycle.record_event(db, interview, "started", "hr", principal.user.id)
    commit_or_conflict(db)
    db.refresh(interview)
    return to_response(interview, principal)


@router.post("/{interview_id}/end", response_model=InterviewResponse)
def end_interview(
    background_tasks: BackgroundTasks,
    body: Optional[InterviewEndRequest] = None,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
    ai=Depends(get_ai_client),
    session_factory=Depends(get_session_factory),
):
    interview, principal = ctx
    require_role(principal, "hr")
    if interview.status == "completed":
        return to_response(interview, principal)
    check_version(interview, body.version if body else None)
    if interview.status != "in_progress":
        raise HTTPException(status_code=409, detail=f"An interview with status '{interview.status}' cannot be ended. Cancel it instead.")

    reason = body.reason if body else "completed"
    # Ending the call also closes an active AI interview. Only a normal end produces an automatic report;
    # if HR left, the session is incomplete and HR can schedule a re-interview.
    from app.services import report_generation
    plan, ai_completed = lifecycle.end_session(db, interview, reason, "hr", principal.user.id)
    commit_or_conflict(db)
    if ai_completed and ai.configured and reason == "completed":
        background_tasks.add_task(report_generation.generate_after_completion, session_factory, ai, plan.id)
    video.close_room(interview.video_room_id)
    db.refresh(interview)
    return to_response(interview, principal)


@router.patch("/{interview_id}/notes", response_model=InterviewResponse)
def update_interview_notes(
    body: InterviewNotesUpdate,
    ctx: tuple = Depends(get_interview_context),
    db: Session = Depends(get_db),
):
    interview, principal = ctx
    require_role(principal, "hr")
    check_version(interview, body.version)
    interview.notes = body.notes
    commit_or_conflict(db)
    db.refresh(interview)
    return to_response(interview, principal)


@router.get("/{interview_id}/events", response_model=List[InterviewEventResponse])
def read_interview_events(ctx: tuple = Depends(get_interview_context)):
    interview, principal = ctx
    require_role(principal, "hr")
    return interview.events


@router.post("/{interview_id}/presence")
def interviewer_heartbeat(ctx: tuple = Depends(get_interview_context), db: Session = Depends(get_db)):
    """Heartbeat from the interviewer's room page (every ~10 s while connected)."""
    interview, principal = ctx
    require_role(principal, "hr")
    if interview.status not in ("accepted", "in_progress", "request_pending"):
        return {"status": interview.status, "recorded": False}
    lifecycle.touch_presence(db, interview, "hr")
    commit_or_conflict(db)
    return {"status": interview.status, "recorded": True}
