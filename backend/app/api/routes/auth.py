from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.api.deps import get_db, get_current_user
from app.core.security import verify_password, create_access_token, get_password_hash
from app.models.user import User
from app.schemas.user import Token, UserResponse, UserSignUp

router = APIRouter()

@router.post("/login", response_model=Token)
def login_access_token(
    db: Session = Depends(get_db), form_data: OAuth2PasswordRequestForm = Depends()
):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    elif not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user"
        )
    
    access_token = create_access_token(subject=user.id)
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserResponse)
def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.post("/signup", status_code=status.HTTP_201_CREATED)
def sign_up(
    user_in: UserSignUp, db: Session = Depends(get_db)
):
    email = user_in.email.lower()
    user = db.query(User).filter(User.email == email).first()
    if user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )
    
    user = User(
        name=user_in.full_name,
        email=email,
        password_hash=get_password_hash(user_in.password),
        role="hr", # Intended default role
    )
    db.add(user)
    db.commit()
    return {"message": "Account created successfully."}
