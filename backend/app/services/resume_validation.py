import uuid
import os
import logging
from typing import Callable, Optional
from sqlalchemy.orm import Session

from app.models.candidate import Candidate
from app.models.resume import Resume
from app.models.resume_validation import ResumeValidationReport
from app.ai.client import AIClient, AIError
from app.ai.text import ResumeTextError, extract_resume_text
from app.ai.validation_service import generate_validation_structured_output, PROMPT_VERSION
from app.schemas.resume_validation import CategoryScore

logger = logging.getLogger(__name__)

RUBRIC_VERSION = "resume_validation_v1"

# Deterministic Scoring Rules:
# The LLM evaluates findings per category, assigning a score.
# The backend calculates the final score to ensure determinism and bounds:
# 1. Negative scores are rejected (clamped to 0).
# 2. Total category score cannot exceed its defined MAX_SCORES.
# 3. Overall score is the sum of validated category scores.
# 4. LLMs are NOT allowed to invent the final overall score.
MAX_SCORES = {
    'Completeness': 20,
    'Role Relevance': 25,
    'Skill Evidence': 25,
    'Consistency': 15,
    'Readability': 15
}

def normalize_suggested_questions(questions: list) -> list:
    """Normalize historical suggested questions that might lack category or priority."""
    if not questions:
        return []
    
    normalized = []
    for q in questions:
        if isinstance(q, dict):
            new_q = q.copy()
            new_q.setdefault("category", "General Verification")
            new_q.setdefault("priority", "Medium")
            normalized.append(new_q)
        elif hasattr(q, "__dict__"):
            new_q = q.__dict__.copy()
            new_q.setdefault("category", "General Verification")
            new_q.setdefault("priority", "Medium")
            normalized.append(new_q)
        else:
            normalized.append(q)
    return normalized

def request_validation(db: Session, candidate: Candidate, user_id: uuid.UUID, target_role_override: Optional[str] = None) -> ResumeValidationReport:
    resume = candidate.resume
    if resume is None:
        raise ValueError("This candidate has no resume uploaded.")
        
    target_role = target_role_override or candidate.target_role
    if not target_role:
        raise ValueError("Candidate has no target role specified.")

    report = ResumeValidationReport(
        id=uuid.uuid4(),
        candidate_id=candidate.id,
        resume_id=resume.id,
        target_role=target_role,
        validation_status="processing",
        rubric_version=RUBRIC_VERSION,
        created_by=user_id
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report

def run_resume_validation(session_factory: Callable[[], Session], ai: AIClient, report_id: uuid.UUID) -> None:
    db = session_factory()
    try:
        report = db.get(ResumeValidationReport, report_id)
        if report is None:
            return
            
        candidate = db.get(Candidate, report.candidate_id)
        resume = db.get(Resume, report.resume_id) if report.resume_id else None
        
        try:
            if resume is None or not os.path.exists(resume.file_path):
                raise ResumeTextError("The resume file could not be found.")
                
            with open(resume.file_path, "rb") as fh:
                data = fh.read()
            text = extract_resume_text(data, resume.file_type, resume.original_filename)
            
            output, model = generate_validation_structured_output(ai, text.text, report.target_role, str(candidate.id))
            
            category_totals = {
                'Completeness': 0, 'Role Relevance': 0, 'Skill Evidence': 0, 'Consistency': 0, 'Readability': 0
            }
            
            for finding in output.findings:
                cat = finding.category
                if cat in category_totals:
                    category_totals[cat] += finding.score
            
            category_scores = []
            overall = 0
            for cat, max_val in MAX_SCORES.items():
                final_score = min(category_totals[cat], max_val)
                final_score = max(final_score, 0)
                overall += final_score
                category_scores.append(CategoryScore(
                    category=cat,
                    score=final_score,
                    maximum_score=max_val,
                    reasoning_summary=f"Aggregated from {cat} findings."
                ).model_dump())
            
            report.validation_status = "completed"
            report.overall_score = overall
            report.category_scores = category_scores
            report.detailed_findings = [f.model_dump() for f in output.findings]
            report.suggested_questions = [q.model_dump() for q in output.suggested_questions]
            
            report.verification_summary = output.verification_summary.model_dump() if output.verification_summary else {}
            report.evidence = [e.model_dump() for e in output.evidence] if output.evidence else []
            report.inconsistencies = [i.model_dump() for i in output.inconsistencies] if output.inconsistencies else []
            report.missing_information = [m.model_dump() for m in output.missing_information] if output.missing_information else []
            report.project_verification = [p.model_dump() for p in output.project_verification] if output.project_verification else []
            
            # External Verifications
            from app.services.external_verification import verify_linkedin_profile, verify_leetcode_profile, verify_hackerrank_profile
            from app.services.github_verification import verify_github_projects
            
            github_url = text.github_url or getattr(candidate, "github_profile", "")
            if not isinstance(github_url, str):
                github_url = ""
            linkedin_url = text.linkedin_url or getattr(candidate, "linkedin_profile", "")
            if not isinstance(linkedin_url, str):
                linkedin_url = ""
            leetcode_url = text.leetcode_url or ""
            hackerrank_url = text.hackerrank_url or ""
            
            profile_data, project_matches = verify_github_projects(github_url, [p.model_dump() for p in output.project_verification], ai, str(candidate.id))
            
            report.github_verification = {
                "profile": profile_data,
                "project_matches": project_matches
            }
            report.linkedin_verification = verify_linkedin_profile(linkedin_url)
            
            platform_claims = output.platform_claims.model_dump() if output.platform_claims else {}
            report.leetcode_verification = verify_leetcode_profile(leetcode_url, platform_claims.get("leetcode", []))
            report.hackerrank_verification = verify_hackerrank_profile(hackerrank_url, platform_claims.get("hackerrank", []))
            
            report.validation_pipeline = [
                {"step": "resume_extraction", "status": "completed", "message": "Text extracted successfully."},
                {"step": "ai_analysis", "status": "completed", "message": "AI analysis completed."},
                {"step": "github_verification", "status": profile_data.get("status", "not_checked"), "message": profile_data.get("message", "GitHub profile checked.")},
                {"step": "linkedin_verification", "status": report.linkedin_verification.get("status", "not_checked"), "message": "LinkedIn profile checked."},
                {"step": "leetcode_verification", "status": report.leetcode_verification.get("status", "not_checked"), "message": "LeetCode profile checked."},
                {"step": "hackerrank_verification", "status": report.hackerrank_verification.get("status", "not_checked"), "message": "HackerRank profile checked."},
            ]
            
            report.model_name = model
            report.prompt_version = PROMPT_VERSION
            report.error = None
            
        except ResumeTextError as exc:
            report.validation_status = "failed"
            report.error = f"resume_extraction_error: {str(exc)}"
            logger.error(f"ERROR: Resume validation text extraction failed category=resume_extraction_error report_id={report_id} error={str(exc)}")
        except AIError as exc:
            report.validation_status = "failed"
            # Map the AIError kind to an internal category string
            error_cat = f"ai_{exc.kind}_error"
            report.error = f"{error_cat}: {exc.public_message()}"
            logger.error(f"ERROR: Resume validation AI call failed category={error_cat} provider=OpenAI model={model if 'model' in locals() else 'unknown'} report_id={report_id}")
            
        db.commit()
        logger.info("resume validation %s finished with status %s", report_id, report.validation_status)
    except Exception as e:
        db.rollback()
        logger.exception("resume validation %s crashed", report_id)
        report = db.get(ResumeValidationReport, report_id)
        if report is not None:
            report.validation_status = "failed"
            report.error = "unknown_error: Unexpected error during validation."
            db.commit()
    finally:
        db.close()
