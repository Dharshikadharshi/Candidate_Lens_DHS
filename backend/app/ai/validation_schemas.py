"""Pydantic schemas for AI Resume Validation structured output."""
from typing import List, Literal, Optional
from pydantic import BaseModel, Field

CategoryName = Literal["completeness", "role_relevance", "skill_evidence", "consistency", "readability"]
ReviewStatus = Literal["verified", "needs_review", "clarification_recommended"]
SkillEvidenceStatus = Literal["supported", "unsupported", "not_mentioned", "indeterminate"]


class ValidationFinding(BaseModel):
    category: CategoryName
    score: float = Field(..., description="Awarded points for this check")
    max_score: float = Field(..., description="Maximum points possible for this check")
    finding_description: str = Field(..., description="Clear description of what was evaluated")
    relevant_excerpt: Optional[str] = Field(None, description="Direct verbatim quote from resume if applicable, or null")
    section_or_page: Optional[str] = Field(None, description="Section heading or page number, e.g. 'Experience, Page 1'")
    reasoning: str = Field(..., description="Reasoning summary explaining the score and evaluation")
    recommended_action: str = Field(..., description="Actionable recommendation for HR during review or interview")
    review_status: ReviewStatus = Field("verified", description="Review status of the finding")


class SkillEvidenceItem(BaseModel):
    skill: str = Field(..., description="Skill name, e.g. 'React', 'Python', 'Docker'")
    status: SkillEvidenceStatus = Field(..., description="supported, unsupported, not_mentioned, or indeterminate")
    evidence_excerpt: Optional[str] = Field(None, description="Short supporting quote from work/projects if found")
    section_or_page: Optional[str] = Field(None, description="Location in resume")
    notes: Optional[str] = Field(None, description="Context on how the skill is demonstrated or what is missing")


class CategoryScoreDetail(BaseModel):
    score: float = Field(..., description="Category score awarded")
    max_score: float = Field(..., description="Maximum possible score for this category")
    summary: str = Field(..., description="Executive summary for this category")
    findings: List[ValidationFinding] = Field(default_factory=list, description="Detailed findings in this category")


class ResumeValidationAIOutput(BaseModel):
    summary: str = Field(..., description="2-3 sentence overall summary of resume quality and evidence coverage")
    detected_experience_level: str = Field(..., description="'entry', 'mid', 'senior', or 'lead'")
    
    completeness: CategoryScoreDetail = Field(..., description="Category 1: Resume completeness (max 20 pts)")
    role_relevance: CategoryScoreDetail = Field(..., description="Category 2: Target-role relevance (max 25 pts)")
    skill_evidence: CategoryScoreDetail = Field(..., description="Category 3: Evidence supporting listed skills (max 25 pts)")
    consistency: CategoryScoreDetail = Field(..., description="Category 4: Internal consistency (max 15 pts)")
    readability: CategoryScoreDetail = Field(..., description="Category 5: Readability and structure (max 15 pts)")

    skills_map: List[SkillEvidenceItem] = Field(default_factory=list, description="Mapping of key target-role and listed skills")
    suggested_follow_up_questions: List[str] = Field(default_factory=list, description="Targeted interview questions based on validation gaps")
    claims_requiring_verification: List[str] = Field(default_factory=list, description="Specific assertions or metrics HR should explore")
    limitations_disclaimer: str = Field(
        default="This score reflects resume document quality and evidence coverage only. It is not an assessment of candidate competence, honesty, or likelihood of job success.",
        description="Standard assessment limitation note"
    )
