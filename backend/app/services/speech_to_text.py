"""SpeechToTextService: validate a recorded answer and transcribe it. Audio is never stored."""
from typing import Optional

from app.ai.client import AIClient
from app.core.config import settings

ALLOWED_AUDIO_TYPES = {
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3",
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
}
MIN_AUDIO_BYTES = 1500
MIN_DURATION_SECONDS = 1.0


class AudioRejected(Exception):
    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status = status  # "empty" | "invalid"
        self.message = message


def validate_audio(data: bytes, content_type: str, duration_seconds: Optional[float]) -> str:
    base_type = (content_type or "").split(";")[0].strip().lower()
    if base_type not in ALLOWED_AUDIO_TYPES:
        raise AudioRejected("invalid", "Unsupported audio format.")
    if len(data) > settings.AI_MAX_AUDIO_MB * 1024 * 1024:
        raise AudioRejected("invalid", f"Recording is too large (max {settings.AI_MAX_AUDIO_MB} MB).")
    if duration_seconds is not None and duration_seconds > settings.AI_MAX_AUDIO_SECONDS + 5:
        raise AudioRejected("invalid", f"Recording is too long (max {settings.AI_MAX_AUDIO_SECONDS // 60} minutes).")
    if len(data) < MIN_AUDIO_BYTES or (duration_seconds is not None and duration_seconds < MIN_DURATION_SECONDS):
        raise AudioRejected("empty", "No speech was captured. Check your microphone and try again.")
    return base_type


def transcribe_answer(ai: AIClient, *, data: bytes, content_type: str, duration_seconds: Optional[float],
                      topic: Optional[str], interview_id) -> str:
    base_type = validate_audio(data, content_type, duration_seconds)
    result = ai.transcribe(
        data,
        f"answer.{ALLOWED_AUDIO_TYPES[base_type]}",
        base_type,
        duration_seconds=duration_seconds,
        # Vocabulary hint improves recognition of technical terms; it is not candidate data.
        prompt=f"A candidate answering a technical job interview question about {topic}." if topic else None,
        interview_id=interview_id,
    )
    return result.text
