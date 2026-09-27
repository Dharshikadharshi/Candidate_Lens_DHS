import sys
import os
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# connect without db to create db
database_url = make_url(settings.DATABASE_URL)
engine_default = create_engine(
    database_url.set(database="postgres"),
    isolation_level="AUTOCOMMIT",
)
conn = engine_default.connect()
database_exists = conn.execute(
    text("SELECT 1 FROM pg_database WHERE datname = :database_name"),
    {"database_name": database_url.database},
).scalar()
if not database_exists:
    conn.execute(text("CREATE DATABASE candidatelens"))
    print("Created database candidatelens")
conn.close()

from app.db.database import engine, Base
from app.models.user import User
from app.models.candidate import Candidate
from app.models.resume import Resume
from app.models.interview import Interview, InterviewEvent
from app.models import assessment  # noqa: F401
from app.core.security import get_password_hash

# Create tables
Base.metadata.create_all(bind=engine)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
db = SessionLocal()

admin = db.query(User).filter(User.email == "admin@candidatelens.com").first()
if not admin:
    admin = User(
        name="Admin HR",
        email="admin@candidatelens.com",
        password_hash=get_password_hash("admin123"),
        role="hr"
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    print("Created admin user")

# Seed a candidate
c1 = db.query(Candidate).filter(Candidate.email == "alice@example.com").first()
if not c1:
    c1 = Candidate(
        full_name="Alice Smith",
        email="alice@example.com",
        phone="+123456789",
        target_role="Frontend Developer",
        status="awaiting_assessment",
        created_by=admin.id
    )
    db.add(c1)
    db.commit()
    print("Created candidate Alice")

db.close()
