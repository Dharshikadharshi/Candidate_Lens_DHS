from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, List, Literal
from uuid import UUID
from datetime import datetime


class InterviewCreate(BaseModel):
    scheduled_at: Optional[datetime] = None
    duration_minutes: int = Field(30, ge=15, le=180)
    message: Optional[str] = Field(None, max_length=2000)
    instant: bool = False

    @field_validator("scheduled_at")
    @classmethod
    def require_timezone(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is not None and value.tzinfo is None:
            raise ValueError("scheduled_at must include a timezone offset")
        return value

    @model_validator(mode="after")
    def require_schedule(self):
        if not self.instant and self.scheduled_at is None:
            raise ValueError("scheduled_at is required unless instant is true")
        if self.message is not None:
            self.message = self.message.strip() or None
        return self


class VersionedRequest(BaseModel):
    # Optional optimistic-concurrency guard: the version the client last saw.
    version: Optional[int] = None


class InterviewEndRequest(VersionedRequest):
    # "interviewer_left": HR left the call - the session ends incomplete and can be re-interviewed.
    reason: Literal["completed", "interviewer_left"] = "completed"


class InterviewResponseUpdate(VersionedRequest):
    response: Literal["accept", "decline"]


class InterviewNotesUpdate(VersionedRequest):
    notes: str = Field("", max_length=20000)


class InterviewResponse(BaseModel):
    id: UUID
    candidate_id: UUID
    candidate_name: str
    target_role: str
    interviewer_id: UUID
    interviewer_name: Optional[str] = None
    scheduled_at: datetime
    duration_minutes: int
    is_instant: bool
    status: str
    display_status: str
    invitation_message: Optional[str] = None
    invitation_expires_at: Optional[datetime] = None
    join_opens_at: datetime
    join_closes_at: datetime
    can_join: bool
    viewer_role: Literal["hr", "candidate"]
    is_interviewer: bool
    video_provider: str
    video_room_id: Optional[str] = None
    notes: Optional[str] = None  # only returned to the interviewer
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    version: int
    end_reason: Optional[str] = None


class InterviewCreatedResponse(InterviewResponse):
    invitation_url: str
    email_sent: bool
    notification_detail: str


class InvitationLinkResponse(BaseModel):
    invitation_url: str
    invitation_expires_at: Optional[datetime] = None


class InterviewEventResponse(BaseModel):
    id: UUID
    event_type: str
    actor_type: str
    details: Optional[dict] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class JoinRoomResponse(BaseModel):
    provider: str
    server_url: str
    room_name: str
    token: str
    identity: str
    role: Literal["hr", "candidate"]
    expires_at: datetime
    interview: InterviewResponse


class InterviewListResponse(BaseModel):
    items: List[InterviewResponse]
    total: int
