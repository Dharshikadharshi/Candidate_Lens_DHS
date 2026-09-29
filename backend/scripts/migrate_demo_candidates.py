import sys
import os

# Add the root directory to PYTHONPATH so we can import app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import SessionLocal
from app.models.candidate import Candidate
from app.models.user import User
from app.models.resume import Resume
from app.models.interview import Interview, InterviewEvent
from app.models import assessment  # noqa: F401
from app.models import resume_validation  # noqa: F401

def migrate_demo_candidates(hr_email: str):
    db = SessionLocal()
    try:
        # 1. Find the target HR user
        hr_user = db.query(User).filter(User.email == hr_email, User.role == "hr").first()
        if not hr_user:
            print(f"Error: HR user with email '{hr_email}' not found.")
            return

        # 2. Find candidates to migrate (e.g., Alice from seed.py or those with no creator)
        admin = db.query(User).filter(User.email == "admin@candidatelens.com").first()
        
        candidates = db.query(Candidate).all()
        migrated_count = 0
        
        for candidate in candidates:
            # If candidate was created by admin (seed data) or has no creator, assign to the specified HR user
            if candidate.created_by is None or (admin and candidate.created_by == admin.id and hr_user.id != admin.id):
                print(f"Migrating candidate: {candidate.full_name} (ID: {candidate.id}) to {hr_email}")
                candidate.created_by = hr_user.id
                migrated_count += 1
                
        if migrated_count > 0:
            db.commit()
            print(f"Successfully migrated {migrated_count} candidates to {hr_email}.")
        else:
            print("No candidates needed migration.")
            
    finally:
        db.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/migrate_demo_candidates.py <hr_email>")
        print("Example: python scripts/migrate_demo_candidates.py my_test_hr@example.com")
        sys.exit(1)
        
    migrate_demo_candidates(sys.argv[1])
