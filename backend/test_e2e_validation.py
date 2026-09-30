import uuid
from app.db.database import SessionLocal
from app.models.user import User
from app.models.candidate import Candidate
from app.models.resume import Resume
from app.services.resume_validation import request_validation, run_resume_validation
from app.ai.client import _default_provider, AIClient

def run():
    db = SessionLocal()
    candidate = db.query(Candidate).first()
    if not candidate:
        print("No candidate found.")
        return
        
    user_id = candidate.created_by
    report = request_validation(db, candidate, user_id)
    print(f"Created report {report.id}")
    
    provider = _default_provider()
    ai = AIClient(provider, lambda: SessionLocal())
    
    run_resume_validation(lambda: SessionLocal(), ai, report.id)
    
    db.refresh(report)
    print(f"Validation status: {report.validation_status}")
    if report.validation_status == 'failed':
        print(f"Error: {report.error}")
    else:
        print("Validation succeeded!")
        print(f"Overall score: {report.overall_score}")

if __name__ == '__main__':
    run()
