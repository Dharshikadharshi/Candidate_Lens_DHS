import pytest
import io
import os
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.api.deps import get_db, get_current_user
from app.db.database import Base
from app.models.user import User
from app.models.candidate import Candidate
from app.models.resume import Resume
from app.core.security import get_password_hash
import uuid

# Setup test DB
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

# Mock user for auth
mock_user = User(
    id=uuid.UUID("e82939b4-3b2d-45f8-8bb0-c1181f08c346"), 
    email="admin@test.com", 
    password_hash=get_password_hash("password123"),
    role="hr", 
    is_active=True
)

def override_get_current_user():
    return mock_user

app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_current_user] = override_get_current_user

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_db():
    db = TestingSessionLocal()
    
    # Create test candidate
    candidate = Candidate(
        id=uuid.UUID("c52939b4-3b2d-45f8-8bb0-c1181f08c346"),
        full_name="Test Candidate",
        email="candidate@test.com",
        target_role="Tester",
        status="awaiting_assessment"
    )
    db.add(candidate)
    db.commit()
    yield db
    
    # Teardown
    db.query(Resume).delete()
    db.query(Candidate).delete()
    db.commit()
    db.close()
    
    # Clean uploads
    import shutil
    uploads = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
    if os.path.exists(uploads):
        shutil.rmtree(uploads)
    os.remove("./test.db")

def test_unauthenticated_upload():
    # Remove override
    app.dependency_overrides.pop(get_current_user)
    response = client.post("/api/candidates/c52939b4-3b2d-45f8-8bb0-c1181f08c346/resume")
    assert response.status_code == 401
    # Restore override
    app.dependency_overrides[get_current_user] = override_get_current_user

def test_candidate_no_resume(setup_db):
    response = client.get("/api/candidates")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) > 0
    candidate = next(c for c in data["items"] if c["id"] == "c52939b4-3b2d-45f8-8bb0-c1181f08c346")
    assert candidate["resume"] is None

def test_upload_valid_pdf(setup_db):
    file_content = b"%PDF-1.4 mock pdf content"
    files = {"file": ("test_resume.pdf", io.BytesIO(file_content), "application/pdf")}
    
    response = client.post(
        "/api/candidates/c52939b4-3b2d-45f8-8bb0-c1181f08c346/resume",
        files=files
    )
    assert response.status_code == 200
    data = response.json()
    assert data["original_filename"] == "test_resume.pdf"
    assert data["file_type"] == "application/pdf"
    assert data["file_size"] == len(file_content)

def test_upload_valid_docx(setup_db):
    file_content = b"mock docx content"
    files = {"file": ("test_resume.docx", io.BytesIO(file_content), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    
    response = client.post(
        "/api/candidates/c52939b4-3b2d-45f8-8bb0-c1181f08c346/resume",
        files=files
    )
    assert response.status_code == 200
    data = response.json()
    assert data["original_filename"] == "test_resume.docx"
    
def test_reject_unsupported_file_type(setup_db):
    file_content = b"mock txt content"
    files = {"file": ("test.txt", io.BytesIO(file_content), "text/plain")}
    
    response = client.post(
        "/api/candidates/c52939b4-3b2d-45f8-8bb0-c1181f08c346/resume",
        files=files
    )
    assert response.status_code == 400
    assert "Unsupported file format" in response.json()["detail"]

def test_reject_oversized_file(setup_db):
    # 11MB file
    file_content = b"0" * (11 * 1024 * 1024)
    files = {"file": ("big.pdf", io.BytesIO(file_content), "application/pdf")}
    
    response = client.post(
        "/api/candidates/c52939b4-3b2d-45f8-8bb0-c1181f08c346/resume",
        files=files
    )
    assert response.status_code == 400
    assert "File too large" in response.json()["detail"]

def test_download_existing_resume(setup_db):
    response = client.get("/api/candidates/c52939b4-3b2d-45f8-8bb0-c1181f08c346/resume/download")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

def test_reupload_replaces_resume(setup_db):
    file_content = b"updated pdf content"
    files = {"file": ("updated.pdf", io.BytesIO(file_content), "application/pdf")}
    
    response = client.post(
        "/api/candidates/c52939b4-3b2d-45f8-8bb0-c1181f08c346/resume",
        files=files
    )
    assert response.status_code == 200
    data = response.json()
    assert data["original_filename"] == "updated.pdf"
    
    # Verify candidate list has the new resume
    response = client.get("/api/candidates")
    data = response.json()
    candidate = next(c for c in data["items"] if c["id"] == "c52939b4-3b2d-45f8-8bb0-c1181f08c346")
    assert candidate["resume"]["original_filename"] == "updated.pdf"
