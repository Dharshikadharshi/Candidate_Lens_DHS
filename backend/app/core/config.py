from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "CandidateLens"
    API_V1_STR: str = "/api"
    SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    DATABASE_URL: str
    CORS_ORIGINS: List[str] = ["http://localhost:5173"]
    FRONTEND_URL: str = "http://localhost:5173"

    # Interviews
    INTERVIEW_JOIN_EARLY_MINUTES: int = 15
    INTERVIEW_GRACE_MINUTES: int = 60
    # Interviewer presence (heartbeat from the HR room page).
    INTERVIEWER_ABSENT_SECONDS: int = 30   # candidate answers pause after this long without HR
    INTERVIEWER_GONE_SECONDS: int = 120    # the interview ends automatically after this long

    # Video provider (LiveKit). Leave unset to disable joining rooms.
    LIVEKIT_URL: Optional[str] = None  # e.g. ws://localhost:7880 or wss://<project>.livekit.cloud
    LIVEKIT_API_KEY: Optional[str] = None
    LIVEKIT_API_SECRET: Optional[str] = None
    VIDEO_TOKEN_TTL_MINUTES: int = 10

    # AI assessment (OpenAI). Leave OPENAI_API_KEY unset to disable AI features.
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gpt-5.4-mini"
    OPENAI_REASONING_EFFORT: Optional[str] = "low"  # set empty for models without reasoning support
    OPENAI_TRANSCRIPTION_MODEL: str = "gpt-4o-mini-transcribe"
    OPENAI_TIMEOUT_SECONDS: float = 60.0
    OPENAI_MAX_RETRIES: int = 2
    # JSON: {"<model>": {"input_per_1m": 0.0, "output_per_1m": 0.0, "per_audio_minute": 0.0}}.
    # Prices change; costs are only estimated for models listed here.
    AI_PRICING_JSON: Optional[str] = None
    # JSON: {"technical_knowledge": 1.0, ...}. Weights for the documented aggregate score.
    AI_DIMENSION_WEIGHTS_JSON: Optional[str] = None
    # Optional JSON file with extra/overridden role profiles for question generation.
    AI_ROLE_PROFILES_PATH: Optional[str] = None
    AI_MAX_AUDIO_MB: int = 10
    AI_MAX_AUDIO_SECONDS: int = 300

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")

settings = Settings()
