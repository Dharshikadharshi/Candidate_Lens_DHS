from pydantic import BaseModel, EmailStr
from typing import Optional
from uuid import UUID
from datetime import datetime

class UserBase(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    role: Optional[str] = "hr"
    is_active: Optional[bool] = True

class UserCreate(UserBase):
    password: str

class UserSignUp(BaseModel):
    full_name: str
    email: EmailStr
    password: str

class UserResponse(UserBase):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenPayload(BaseModel):
    sub: Optional[str] = None
