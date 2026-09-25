import sys
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# connect without db to create db
engine_default = create_engine('postgresql+psycopg2://postgres:Haresh%40123@localhost/postgres')
conn = engine_default.connect()
from sqlalchemy import text
conn.execute(text("COMMIT"))
try:
    conn.execute(text("CREATE DATABASE candidatelens"))
except Exception as e:
    print("DB might exist: ", e)
conn.close()

from app.db.database import engine, Base
from app.models.user import User
from app.models.candidate import Candidate
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
