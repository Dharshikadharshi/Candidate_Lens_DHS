"""LiveKit integration boundary.

Access tokens are LiveKit-format JWTs (HS256, signed with the API secret) so no
extra SDK dependency is needed. The secret never leaves the backend.
"""
import json
import logging
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from jose import jwt

from app.core.config import settings

logger = logging.getLogger(__name__)

PROVIDER_NAME = "livekit"


class VideoProviderNotConfigured(Exception):
    pass


@dataclass
class VideoAccess:
    server_url: str
    room_name: str
    token: str
    identity: str
    expires_at: datetime


def is_configured() -> bool:
    return bool(settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET)


def _sign(claims: dict, ttl_seconds: int) -> str:
    now = int(time.time())
    payload = {"iss": settings.LIVEKIT_API_KEY, "nbf": now, "exp": now + ttl_seconds, **claims}
    return jwt.encode(payload, settings.LIVEKIT_API_SECRET, algorithm="HS256")


def create_access_token(room_name: str, identity: str, display_name: str, metadata: dict) -> VideoAccess:
    if not is_configured():
        raise VideoProviderNotConfigured(
            "Video provider is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET."
        )
    ttl = settings.VIDEO_TOKEN_TTL_MINUTES * 60
    token = _sign(
        {
            "sub": identity,
            "jti": identity,
            "name": display_name,
            "metadata": json.dumps(metadata),
            "video": {
                "room": room_name,
                "roomJoin": True,
                "canPublish": True,
                "canSubscribe": True,
                "canPublishData": True,
            },
        },
        ttl,
    )
    server_url = settings.LIVEKIT_URL
    if server_url.startswith("https://"):
        server_url = server_url.replace("https://", "wss://", 1)
    elif server_url.startswith("http://"):
        server_url = server_url.replace("http://", "ws://", 1)

    return VideoAccess(
        server_url=server_url,
        room_name=room_name,
        token=token,
        identity=identity,
        expires_at=datetime.fromtimestamp(time.time() + ttl, tz=timezone.utc),
    )


def close_room(room_name: Optional[str]) -> None:
    """Best effort: delete the room so connected participants are disconnected."""
    if not room_name or not is_configured():
        return
    http_url = settings.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")
    token = _sign({"video": {"roomCreate": True, "room": room_name}}, 60)
    request = urllib.request.Request(
        f"{http_url}/twirp/livekit.RoomService/DeleteRoom",
        data=json.dumps({"room": room_name}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=5).close()
    except Exception as exc:  # room may not exist if nobody joined
        logger.info("Could not close video room %s: %s", room_name, exc)
