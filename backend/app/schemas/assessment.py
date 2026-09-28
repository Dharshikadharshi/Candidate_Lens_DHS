from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.ai.rubric import DEFAULT_QUESTION_COUNTS


class QuestionCounts(BaseModel):
    resume_technical: int = Field(DEFAULT_QUESTION_COUNTS["resume_technical"], ge=0, le=5)
    technical_knowledge: int = Field(DEFAULT_QUESTION_COUNTS["technical_knowledge"], ge=0, le=5)
    project_defense: int = Field(DEFAULT_QUESTION_COUNTS["project_defense"], ge=0, le=5)
    scenario: int = Field(DEFAULT_QUESTION_COUNTS["scenario"], ge=0, le=5)


class AIPlanConfig(BaseModel):
    target_role: Optional[str] = Field(None, max_length=120)  # defaults to the candidate's target role
    difficulty: Optional[Literal["junior", "mid", "senior"]] = None  # defaults from resume experience
    question_counts: QuestionCounts = QuestionCounts()
    enable_resume_questions: bool = True
    enable_technical_questions: bool = True
    enable_project_defense: bool = True
    enable_scenarios: bool = True
    # Prototype limit: at most one follow-up per main question.
    max_follow_ups_per_question: int = Field(1, ge=0, le=1)
    speech_to_text_enabled: bool = True
    typed_answers_allowed: bool = True

    @model_validator(mode="after")
    def check(self):
        if not (self.speech_to_text_enabled or self.typed_answers_allowed):
            raise ValueError("Enable speech-to-text, typed answers, or both.")
        return self


class PlanCreateRequest(BaseModel):
    config: AIPlanConfig = AIPlanConfig()
    regenerate: bool = False


class ResumeAnalysisRequest(BaseModel):
    force: bool = False


class NextQuestionRequest(BaseModel):
    action: Literal["start", "advance", "skip"]
    reason: Optional[str] = Field(None, max_length=500)
    version: Optional[int] = None  # optimistic concurrency guard (plan version)


class AnswerSubmit(BaseModel):
    answer_text: str = Field(..., max_length=6000)
    capture_method: Literal["typed", "voice"] = "typed"
    transcript_flagged: bool = False
    transcript_flag_note: Optional[str] = Field(None, max_length=500)
    idempotency_key: str = Field(..., min_length=8, max_length=64)


class ConsentRequest(BaseModel):
    acknowledge_ai_disclosure: bool
    transcription_consent: bool


class TranscriptFlagRequest(BaseModel):
    flagged: bool = True
    note: Optional[str] = Field(None, max_length=500)


class EvaluationReviewRequest(BaseModel):
    dimension: Literal[
        "technical_knowledge", "problem_solving", "communication_clarity", "project_understanding", "scenario_application",
    ]
    action: Literal["override", "mark_needs_review", "confirm"]
    score: Optional[int] = Field(None, ge=1, le=5)
    note: str = Field(..., min_length=3, max_length=1000)

    @model_validator(mode="after")
    def check(self):
        if self.action == "override" and self.score is None:
            raise ValueError("A score is required to override an evaluation.")
        return self


class ReportReviewRequest(BaseModel):
    hr_notes: Optional[str] = Field(None, max_length=10000)
    hr_clarifications: Optional[str] = Field(None, max_length=5000)
    hr_next_step: Optional[Literal[
        "proceed_to_round_1", "additional_assessment", "on_hold", "do_not_proceed", "undecided",
    ]] = None
    hr_decision: Optional[str] = Field(None, max_length=5000)
    version: Optional[int] = None
