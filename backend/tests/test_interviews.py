import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qs

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.api.deps import get_db
from app.core.config import settings
from app.core.security import create_access_token
from app.db.database import Base
from app.models.user import User
from app.models.candidate import Candidate
from app.models.interview import Interview
from app.services import video

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

HR_ID = uuid.UUID("a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1")
OTHER_HR_ID = uuid.UUID("b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2")

client = TestClient(app)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def isolated_app():
    # Other test modules install global overrides at import time; swap them out for this module.
    saved = dict(app.dependency_overrides)
    app.dependency_overrides.clear()
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    db.add_all([
        User(id=HR_ID, name="Priya HR", email="priya@test.com", password_hash="x", role="hr", is_active=True),
        User(id=OTHER_HR_ID, name="Other HR", email="other@test.com", password_hash="x", role="hr", is_active=True),
    ])
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(saved)


@pytest.fixture
def livekit(monkeypatch):
    monkeypatch.setattr(settings, "LIVEKIT_URL", "ws://livekit.test:7880")
    monkeypatch.setattr(settings, "LIVEKIT_API_KEY", "testkey")
    monkeypatch.setattr(settings, "LIVEKIT_API_SECRET", "testsecret-that-is-long-enough-123")
    closed = []
    monkeypatch.setattr(video, "close_room", lambda room: closed.append(room))
    return closed


def hr(user_id=HR_ID):
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


def cand(token):
    return {"X-Invitation-Token": token}


def make_candidate():
    db = TestingSessionLocal()
    c = Candidate(
        full_name="Test Candidate",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        phone="12345",
        target_role="Backend Developer",
        status="awaiting_assessment",
        created_by=HR_ID,
    )
    db.add(c)
    db.commit()
    c_id = str(c.id)
    db.close()
    return c_id


def future(hours=48):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def create_interview(candidate_id, **overrides):
    body = {"scheduled_at": future(), "duration_minutes": 30, "message": "Hello"}
    body.update(overrides)
    res = client.post(f"/api/candidates/{candidate_id}/interviews", json=body, headers=hr())
    assert res.status_code == 201, res.text
    data = res.json()
    token = parse_qs(urlparse(data["invitation_url"]).query)["token"][0]
    return data, token


def shift_schedule(interview_id, delta):
    db = TestingSessionLocal()
    i = db.query(Interview).filter(Interview.id == uuid.UUID(interview_id)).first()
    i.scheduled_at = i.scheduled_at + delta
    i.invitation_expires_at = i.invitation_expires_at + delta
    db.commit()
    db.close()


# --- Candidate profile -------------------------------------------------------

def test_hr_can_read_candidate_profile():
    c_id = make_candidate()
    res = client.get(f"/api/candidates/{c_id}", headers=hr())
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == c_id
    assert data["target_role"] == "Backend Developer"
    assert data["created_by_name"] == "Priya HR"


def test_candidate_profile_requires_auth_and_existing_id():
    c_id = make_candidate()
    assert client.get(f"/api/candidates/{c_id}").status_code == 401
    assert client.get(f"/api/candidates/{uuid.uuid4()}", headers=hr()).status_code == 404
    assert client.get("/api/candidates/not-a-uuid", headers=hr()).status_code == 400


# --- Creating requests -------------------------------------------------------

def test_hr_can_create_interview_request():
    c_id = make_candidate()
    data, token = create_interview(c_id)
    assert data["status"] == "request_pending"
    assert data["display_status"] == "request_pending"
    assert data["email_sent"] is False
    assert data["interviewer_name"] == "Priya HR"
    assert data["can_join"] is False

    db = TestingSessionLocal()
    stored = db.query(Interview).filter(Interview.id == uuid.UUID(data["id"])).first()
    assert stored.invitation_token_hash and token not in stored.invitation_token_hash
    db.close()

    listing = client.get(f"/api/candidates/{c_id}/interviews", headers=hr()).json()
    assert listing["total"] == 1 and listing["items"][0]["id"] == data["id"]


def test_conflicting_active_request_is_rejected():
    c_id = make_candidate()
    create_interview(c_id)
    res = client.post(f"/api/candidates/{c_id}/interviews", json={"scheduled_at": future(), "duration_minutes": 30}, headers=hr())
    assert res.status_code == 409


def test_invalid_schedule_is_rejected():
    c_id = make_candidate()
    url = f"/api/candidates/{c_id}/interviews"
    naive = (datetime.utcnow() + timedelta(days=1)).replace(tzinfo=None).isoformat()
    assert client.post(url, json={"scheduled_at": naive, "duration_minutes": 30}, headers=hr()).status_code == 422
    assert client.post(url, json={"scheduled_at": future(-2), "duration_minutes": 30}, headers=hr()).status_code == 400
    assert client.post(url, json={"scheduled_at": future(), "duration_minutes": 5}, headers=hr()).status_code == 422
    assert client.post(url, json={"duration_minutes": 30}, headers=hr()).status_code == 422
    assert client.post(url, json={"scheduled_at": future(), "duration_minutes": 30}).status_code == 401


# --- Authorization -----------------------------------------------------------

def test_candidate_can_view_only_own_invitation():
    data_a, token_a = create_interview(make_candidate())
    data_b, _ = create_interview(make_candidate())

    res = client.get(f"/api/interviews/{data_a['id']}", headers=cand(token_a))
    assert res.status_code == 200
    assert res.json()["viewer_role"] == "candidate"
    assert res.json()["notes"] is None

    assert client.get(f"/api/interviews/{data_b['id']}", headers=cand(token_a)).status_code == 403
    assert client.get(f"/api/interviews/{data_a['id']}", headers=cand("forged")).status_code == 403
    assert client.get(f"/api/interviews/{data_a['id']}").status_code == 401


def test_other_hr_cannot_access_or_join_interview(livekit):
    data, _ = create_interview(make_candidate(), instant=True)
    other = hr(OTHER_HR_ID)
    assert client.get(f"/api/interviews/{data['id']}", headers=other).status_code == 403
    assert client.post(f"/api/interviews/{data['id']}/join", headers=other).status_code == 403
    assert client.patch(f"/api/interviews/{data['id']}/cancel", headers=other).status_code == 403


def test_candidate_cannot_perform_hr_actions():
    data, token = create_interview(make_candidate())
    i_id = data["id"]
    assert client.patch(f"/api/interviews/{i_id}/cancel", headers=cand(token)).status_code == 403
    assert client.post(f"/api/interviews/{i_id}/start", headers=cand(token)).status_code == 403
    assert client.post(f"/api/interviews/{i_id}/end", headers=cand(token)).status_code == 403
    assert client.patch(f"/api/interviews/{i_id}/notes", json={"notes": "x"}, headers=cand(token)).status_code == 403
    assert client.patch(f"/api/interviews/{i_id}/response", json={"response": "accept"}, headers=hr()).status_code == 403


# --- Candidate responses -----------------------------------------------------

def test_candidate_can_accept():
    data, token = create_interview(make_candidate())
    res = client.patch(f"/api/interviews/{data['id']}/response", json={"response": "accept"}, headers=cand(token))
    assert res.status_code == 200
    assert res.json()["status"] == "accepted"
    assert res.json()["display_status"] == "scheduled"  # 48h away: not yet ready

    hr_view = client.get(f"/api/interviews/{data['id']}", headers=hr()).json()
    assert hr_view["status"] == "accepted"


def test_candidate_can_decline_and_then_not_accept():
    data, token = create_interview(make_candidate())
    url = f"/api/interviews/{data['id']}/response"
    assert client.patch(url, json={"response": "decline"}, headers=cand(token)).json()["status"] == "declined"
    assert client.patch(url, json={"response": "accept"}, headers=cand(token)).status_code == 409


def test_cancelled_invitation_cannot_be_accepted_or_joined(livekit):
    data, token = create_interview(make_candidate(), instant=True)
    res = client.patch(f"/api/interviews/{data['id']}/cancel", headers=hr())
    assert res.status_code == 200 and res.json()["status"] == "cancelled"
    assert livekit == [data["video_room_id"]]

    assert client.patch(f"/api/interviews/{data['id']}/response", json={"response": "accept"}, headers=cand(token)).status_code == 409
    assert client.post(f"/api/interviews/{data['id']}/join", headers=cand(token)).status_code == 409
    assert client.post(f"/api/interviews/{data['id']}/join", headers=hr()).status_code == 409


def test_expired_invitation_cannot_be_accepted_or_joined(livekit):
    data, token = create_interview(make_candidate())
    shift_schedule(data["id"], -timedelta(days=5))

    view = client.get(f"/api/interviews/{data['id']}", headers=cand(token)).json()
    assert view["status"] == "expired"
    assert client.patch(f"/api/interviews/{data['id']}/response", json={"response": "accept"}, headers=cand(token)).status_code == 409
    assert client.post(f"/api/interviews/{data['id']}/join", headers=cand(token)).status_code == 409


def test_expired_request_no_longer_blocks_a_new_one():
    c_id = make_candidate()
    data, _ = create_interview(c_id)
    shift_schedule(data["id"], -timedelta(days=5))
    create_interview(c_id)


# --- Joining the room --------------------------------------------------------

def test_join_reports_unconfigured_provider(monkeypatch):
    monkeypatch.setattr(settings, "LIVEKIT_URL", None)
    data, _ = create_interview(make_candidate(), instant=True)
    res = client.post(f"/api/interviews/{data['id']}/join", headers=hr())
    assert res.status_code == 503
    assert "LIVEKIT_URL" in res.json()["detail"]


def test_only_authorized_participants_get_room_tokens(livekit):
    data, token = create_interview(make_candidate(), instant=True)
    i_id = data["id"]

    # Candidate must accept first; HR may wait in an instant interview's room.
    assert client.post(f"/api/interviews/{i_id}/join", headers=cand(token)).status_code == 409
    hr_join = client.post(f"/api/interviews/{i_id}/join", headers=hr())
    assert hr_join.status_code == 200

    client.patch(f"/api/interviews/{i_id}/response", json={"response": "accept"}, headers=cand(token))
    cand_join = client.post(f"/api/interviews/{i_id}/join", headers=cand(token))
    assert cand_join.status_code == 200
    body = cand_join.json()
    assert body["server_url"] == "ws://livekit.test:7880"
    assert "testsecret" not in cand_join.text

    claims = jwt.decode(body["token"], "testsecret-that-is-long-enough-123", algorithms=["HS256"])
    assert claims["iss"] == "testkey"
    assert claims["video"]["room"] == data["video_room_id"]
    assert claims["video"]["roomJoin"] is True
    assert claims["sub"].startswith("candidate-")
    assert claims["exp"] - claims["nbf"] == settings.VIDEO_TOKEN_TTL_MINUTES * 60

    hr_claims = jwt.get_unverified_claims(hr_join.json()["token"])
    assert hr_claims["sub"] == f"hr-{HR_ID}"


def test_scheduled_room_is_closed_until_join_window(livekit):
    data, token = create_interview(make_candidate())
    client.patch(f"/api/interviews/{data['id']}/response", json={"response": "accept"}, headers=cand(token))
    assert client.post(f"/api/interviews/{data['id']}/join", headers=cand(token)).status_code == 409

    shift_schedule(data["id"], -timedelta(hours=48) + timedelta(minutes=5))
    view = client.get(f"/api/interviews/{data['id']}", headers=cand(token)).json()
    assert view["display_status"] == "ready" and view["can_join"] is True
    assert client.post(f"/api/interviews/{data['id']}/join", headers=cand(token)).status_code == 200


# --- Start / end -------------------------------------------------------------

def test_invalid_state_transitions_are_rejected(livekit):
    data, token = create_interview(make_candidate(), instant=True)
    i_id = data["id"]
    assert client.post(f"/api/interviews/{i_id}/start", headers=hr()).status_code == 409  # not accepted
    assert client.post(f"/api/interviews/{i_id}/end", headers=hr()).status_code == 409  # not started

    client.patch(f"/api/interviews/{i_id}/response", json={"response": "accept"}, headers=cand(token))
    client.post(f"/api/interviews/{i_id}/start", headers=hr())
    assert client.patch(f"/api/interviews/{i_id}/cancel", headers=hr()).status_code == 409  # in progress
    assert client.patch(f"/api/interviews/{i_id}/response", json={"response": "decline"}, headers=cand(token)).status_code == 409


def test_start_and_end_timestamps_are_persisted(livekit):
    data, token = create_interview(make_candidate(), instant=True)
    i_id = data["id"]
    client.patch(f"/api/interviews/{i_id}/response", json={"response": "accept"}, headers=cand(token))

    started = client.post(f"/api/interviews/{i_id}/start", headers=hr())
    assert started.status_code == 200
    assert started.json()["status"] == "in_progress" and started.json()["started_at"]
    # Reconnecting HR calling start again is a no-op.
    assert client.post(f"/api/interviews/{i_id}/start", headers=hr()).json()["started_at"] == started.json()["started_at"]
    # Participants can rejoin while in progress.
    assert client.post(f"/api/interviews/{i_id}/join", headers=cand(token)).status_code == 200

    ended = client.post(f"/api/interviews/{i_id}/end", headers=hr())
    assert ended.status_code == 200
    assert ended.json()["status"] == "completed" and ended.json()["ended_at"]
    assert livekit == [data["video_room_id"]]

    db = TestingSessionLocal()
    stored = db.query(Interview).filter(Interview.id == uuid.UUID(i_id)).first()
    assert stored.started_at is not None and stored.ended_at is not None
    assert stored.ended_at >= stored.started_at
    db.close()

    events = [e["event_type"] for e in client.get(f"/api/interviews/{i_id}/events", headers=hr()).json()]
    assert events[0] == "request_created" and "started" in events and events[-1] == "ended"
    assert client.post(f"/api/interviews/{i_id}/join", headers=cand(token)).status_code == 409


# --- Optimistic concurrency --------------------------------------------------

def test_stale_version_is_rejected():
    data, token = create_interview(make_candidate())
    i_id = data["id"]
    seen_version = data["version"]
    accepted = client.patch(f"/api/interviews/{i_id}/response", json={"response": "accept", "version": seen_version}, headers=cand(token))
    assert accepted.status_code == 200
    assert accepted.json()["version"] == seen_version + 1

    # HR acting on the pre-acceptance snapshot is told to reload.
    res = client.patch(f"/api/interviews/{i_id}/cancel", json={"version": seen_version}, headers=hr())
    assert res.status_code == 409
    assert client.patch(f"/api/interviews/{i_id}/cancel", json={"version": seen_version + 1}, headers=hr()).status_code == 200


def test_notes_visible_only_to_interviewer():
    data, token = create_interview(make_candidate())
    res = client.patch(f"/api/interviews/{data['id']}/notes", json={"notes": "Strong on SQL"}, headers=hr())
    assert res.status_code == 200 and res.json()["notes"] == "Strong on SQL"
    assert client.get(f"/api/interviews/{data['id']}", headers=cand(token)).json()["notes"] is None


def test_regenerated_link_invalidates_old_token():
    data, old_token = create_interview(make_candidate())
    res = client.post(f"/api/interviews/{data['id']}/invitation-link", headers=hr())
    assert res.status_code == 200
    new_token = parse_qs(urlparse(res.json()["invitation_url"]).query)["token"][0]
    assert client.get(f"/api/interviews/{data['id']}", headers=cand(old_token)).status_code == 403
    assert client.get(f"/api/interviews/{data['id']}", headers=cand(new_token)).status_code == 200


def test_deleting_candidate_removes_interviews():
    c_id = make_candidate()
    data, _ = create_interview(c_id)
    assert client.delete(f"/api/candidates/{c_id}", headers=hr()).status_code == 200
    assert client.get(f"/api/interviews/{data['id']}", headers=hr()).status_code == 404
