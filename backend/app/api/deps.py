import uuid
from typing import Generator, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.core.config import settings
from app.models.user import User
from app.schemas.user import TokenPayload

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")
optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login", auto_error=False)

def get_db() -> Generator:
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()

def get_current_user(
    db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        token_data = TokenPayload(**payload)
        if token_data.sub is None:
            raise credentials_exception
        user_id = uuid.UUID(token_data.sub)
    except (JWTError, ValueError):
        raise credentials_exception
    
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    return user


def get_optional_current_user(
    db: Session = Depends(get_db), token: Optional[str] = Depends(optional_oauth2_scheme)
) -> Optional[User]:
    """Like get_current_user, but returns None when no bearer token is sent.

    Used by routes that also accept a candidate invitation token.
    """
    if not token:
        return None
    return get_current_user(db=db, token=token)


def get_session_factory():
    """Session factory for work that outlives the request (background AI jobs, usage logging)."""
    return SessionLocal


def get_ai_client(session_factory=Depends(get_session_factory)):
    from app.ai.client import AIClient, _default_provider

    return AIClient(_default_provider(), session_factory)
