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
from app.core.security import get_password_hash
import uuid

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_candidates.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

mock_user = User(
    id=uuid.UUID("e82939b4-3b2d-45f8-8bb0-c1181f08c346"), 
    email="admin@test.com", 
    password_hash="fakehash",
    role="hr", 
    is_active=True
)

def override_get_current_user():
    return mock_user

app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_current_user] = override_get_current_user

client = TestClient(app)

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    db = TestingSessionLocal()
    yield db
    
    db.query(Candidate).delete()
    db.commit()
    db.close()
    
    import shutil
    uploads = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
    if os.path.exists(uploads):
        shutil.rmtree(uploads)
    if os.path.exists("./test_candidates.db"):
        try:
            os.remove("./test_candidates.db")
        except PermissionError:
            pass

def test_reject_unauthorized_candidate_creation():
    app.dependency_overrides.pop(get_current_user)
    response = client.post("/api/candidates", json={
        "full_name": "John Doe",
        "email": "johndoe@example.com",
        "phone": "1234567890",
        "target_role": "ML Engineer"
    })
    assert response.status_code == 401
    app.dependency_overrides[get_current_user] = override_get_current_user

def test_create_candidate_without_resume():
    response = client.post("/api/candidates", json={
        "full_name": "Alice Smith",
        "email": "alice@example.com",
        "phone": "1112223333",
        "target_role": "Frontend Developer"
    })
    assert response.status_code == 201
    data = response.json()
    assert data["full_name"] == "Alice Smith"
    assert data["email"] == "alice@example.com"
    assert data["target_role"] == "Frontend Developer"
    assert data["status"] == "awaiting_assessment"
    assert "id" in data

def test_create_candidate_successfully():
    response = client.post("/api/candidates", json={
        "full_name": "Bob Jones",
        "email": "bob@example.com",
        "phone": "5556667777",
        "target_role": "Backend Developer"
    })
    assert response.status_code == 201
    data = response.json()
    assert data["full_name"] == "Bob Jones"
    
def test_create_candidate_with_resume():
    # 1. Create candidate
    response = client.post("/api/candidates", json={
        "full_name": "Charlie Brown",
        "email": "charlie@example.com",
        "phone": "9998887777",
        "target_role": "ML Engineer"
    })
    assert response.status_code == 201
    candidate_id = response.json()["id"]

    # 2. Upload resume
    file_content = b"PDF content for Charlie"
    files = {"file": ("charlie_resume.pdf", io.BytesIO(file_content), "application/pdf")}
    res_response = client.post(f"/api/candidates/{candidate_id}/resume", files=files)
    assert res_response.status_code == 200
    assert res_response.json()["original_filename"] == "charlie_resume.pdf"

def test_reject_missing_name():
    response = client.post("/api/candidates", json={
        "email": "noname@example.com",
        "target_role": "ML Engineer"
    })
    assert response.status_code == 422

def test_reject_invalid_email():
    response = client.post("/api/candidates", json={
        "full_name": "Invalid Email",
        "email": "not-an-email",
        "target_role": "ML Engineer"
    })
    assert response.status_code == 422

def test_reject_duplicate_email():
    response = client.post("/api/candidates", json={
        "full_name": "Duplicate",
        "email": "alice@example.com",
        "target_role": "ML Engineer"
    })
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]

def test_verify_newly_created_candidate_in_list():
    response = client.get("/api/candidates")
    assert response.status_code == 200
    data = response.json()
    emails = [c["email"] for c in data["items"]]
    assert "bob@example.com" in emails
    assert "alice@example.com" in emails
    assert "charlie@example.com" in emails
    assert data["total"] >= 3

def test_verify_search_finds_newly_created_candidate():
    response = client.get("/api/candidates?search=charlie")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["email"] == "charlie@example.com"

def test_verify_role_filtering_works():
    response = client.get("/api/candidates?role=Frontend Developer")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["target_role"] == "Frontend Developer"

def test_verify_dashboard_statistics_update_correctly():
    # Adding one more with different status (mocking it) isn't necessary,
    # we just need to know the total updates correctly.
    response = client.get("/api/candidates")
    total_before = response.json()["total"]
    
    client.post("/api/candidates", json={
        "full_name": "Stat Test",
        "email": "stat@example.com",
        "target_role": "Backend Developer"
    })
    
    response2 = client.get("/api/candidates")
    total_after = response2.json()["total"]
    assert total_after == total_before + 1

def test_update_candidate_status_successfully():
    response = client.post("/api/candidates", json={
        "full_name": "Status Test",
        "email": "status@example.com",
        "target_role": "Backend Developer"
    })
    c_id = response.json()["id"]

    response = client.patch(f"/api/candidates/{c_id}/status", json={"status": "completed"})
    assert response.status_code == 200
    assert response.json()["status"] == "completed"

def test_reject_invalid_status():
    response = client.get("/api/candidates?search=status@example.com")
    c_id = response.json()["items"][0]["id"]
    
    response = client.patch(f"/api/candidates/{c_id}/status", json={"status": "invalid_status"})
    assert response.status_code == 400

def test_reject_unauthenticated_status_update():
    response = client.get("/api/candidates?search=status@example.com")
    c_id = response.json()["items"][0]["id"]
    
    app.dependency_overrides.pop(get_current_user)
    response = client.patch(f"/api/candidates/{c_id}/status", json={"status": "completed"})
    assert response.status_code == 401
    app.dependency_overrides[get_current_user] = override_get_current_user

def test_delete_missing_candidate():
    response = client.delete(f"/api/candidates/{uuid.uuid4()}")
    assert response.status_code == 404

def test_reject_unauthenticated_delete():
    response = client.get("/api/candidates?search=status@example.com")
    c_id = response.json()["items"][0]["id"]
    
    app.dependency_overrides.pop(get_current_user)
    response = client.delete(f"/api/candidates/{c_id}")
    assert response.status_code == 401
    app.dependency_overrides[get_current_user] = override_get_current_user

def test_successfully_delete_candidate():
    # 1. Create candidate and resume
    response = client.post("/api/candidates", json={
        "full_name": "Delete Me",
        "email": "delete@example.com",
        "target_role": "Frontend Developer"
    })
    c_id = response.json()["id"]

    file_content = b"PDF content"
    files = {"file": ("resume.pdf", io.BytesIO(file_content), "application/pdf")}
    res_response = client.post(f"/api/candidates/{c_id}/resume", files=files)
    assert res_response.status_code == 200
    
    # 2. Delete candidate
    del_response = client.delete(f"/api/candidates/{c_id}")
    assert del_response.status_code == 200
    
    # 3. Verify missing
    get_response = client.get("/api/candidates")
    emails = [c["email"] for c in get_response.json()["items"]]
    assert "delete@example.com" not in emails
