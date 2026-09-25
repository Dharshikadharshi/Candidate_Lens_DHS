from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    PROJECT_NAME: str = "CandidateLens"
    API_V1_STR: str = "/api"
    SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    DATABASE_URL: str
    CORS_ORIGINS: List[str] = ["http://localhost:5173"]

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

settings = Settings()
