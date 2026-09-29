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

def inspect_candidate(candidate_id: str):
    db = SessionLocal()
    try:
        candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
        if not candidate:
            print(f"Candidate {candidate_id} not found")
            return
        
        print("CANDIDATE INFO:")
        print(f"candidate.id = {candidate.id}")
        print(f"candidate.name = {candidate.full_name}")
        print(f"candidate.created_by = {candidate.created_by}")
        
        print("\nALL HR USERS IN DB:")
        users = db.query(User).filter(User.role == "hr").all()
        for u in users:
            print(f"User: id={u.id}, email={u.email}, role={u.role}")
            
    finally:
        db.close()

if __name__ == "__main__":
    inspect_candidate("c58429d7-c7b1-410d-9af5-f90f54e93f7e")
