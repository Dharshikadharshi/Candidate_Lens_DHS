import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import SessionLocal
from app.models.candidate import Candidate
from app.models.user import User
from app.models.resume import Resume
from app.models.interview import Interview, InterviewEvent
from app.models import assessment
from app.models import resume_validation

def force_migrate_candidate(candidate_id: str, target_hr_email: str):
    db = SessionLocal()
    try:
        hr_user = db.query(User).filter(User.email == target_hr_email, User.role == "hr").first()
        if not hr_user:
            print(f"Error: Target HR user '{target_hr_email}' not found.")
            return

        candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
        if not candidate:
            print(f"Error: Candidate '{candidate_id}' not found.")
            return
            
        print(f"Current owner: {candidate.created_by}")
        candidate.created_by = hr_user.id
        db.commit()
        print(f"Successfully migrated candidate {candidate_id} to {target_hr_email} (ID: {hr_user.id})")
        
    finally:
        db.close()

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python scripts/force_migrate_candidate.py <candidate_id> <target_hr_email>")
        sys.exit(1)
        
    force_migrate_candidate(sys.argv[1], sys.argv[2])
