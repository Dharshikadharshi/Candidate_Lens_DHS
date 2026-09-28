export type AnswerState =
  | 'waiting_for_answer'
  | 'processing'
  | 'transcript_ready'
  | 'transcription_failed'
  | 'answer_submitted'
  | 'evaluation_in_progress'
  | 'evaluation_completed'
  | 'evaluation_failed';

export type PlanStatus = 'not_configured' | 'generating' | 'ready' | 'failed' | 'active' | 'completed';

export type DimensionKey =
  | 'technical_knowledge'
  | 'problem_solving'
  | 'communication_clarity'
  | 'project_understanding'
  | 'scenario_application';

export interface AIAnswer {
  id: string;
  status: 'draft' | 'submitted';
  capture_method: 'typed' | 'voice';
  transcription_status: 'not_applicable' | 'processing' | 'completed' | 'empty' | 'failed';
  transcription_error: string | null;
  transcript_text: string | null;
  answer_text: string | null;
  transcript_edited: boolean;
  transcript_flagged: boolean;
  submitted_at: string | null;
  idempotency_key: string | null;
  // HR only
  evaluation_status?: 'not_started' | 'in_progress' | 'completed' | 'failed';
  evaluation_error?: string | null;
  evaluation_attempts?: number;
  transcript_quality?: string | null;
  transcript_flag_note?: string | null;
  missing_evidence?: string[];
}

export interface AIEvaluation {
  id: string;
  dimension: DimensionKey;
  dimension_label: string;
  evidence_status: 'scored' | 'insufficient_data' | 'needs_review';
  score: number | null;
  rationale: string | null;
  evidence_excerpt: string | null;
  excerpt_verified: boolean | null;
  confidence: string | null;
  review_status: string;
  source: 'ai' | 'hr';
  rubric_version: string;
  evaluation_version: number;
}

export interface SourceClaim {
  claim_id: string;
  claim: string;
  source_text: string | null;
  page: number | null;
  section: string | null;
  source_verified?: boolean;
}

export interface AIQuestion {
  id: string;
  label: string;
  number: number;
  total: number;
  is_follow_up: boolean;
  text: string;
  category_label: string;
  answer_state: AnswerState;
  answer: AIAnswer | null;
  // HR only
  category?: string;
  status?: string;
  topic?: string;
  dimensions?: DimensionKey[];
  expected_evidence?: string[];
  source_claim?: SourceClaim | null;
  skip_reason?: string | null;
  next_action?: { decision: string; reason: string; decided_by: string } | null;
  evaluations?: AIEvaluation[];
}

export interface CurrentAIState {
  plan_status: PlanStatus;
  plan_version?: number;
  question: AIQuestion | null;
  answered_count?: number;
  total_main?: number;
  consent: { ai_disclosure_acknowledged: boolean; transcription_consent: boolean | null } | null;
  capture: { voice: boolean; voice_enabled: boolean; typed: boolean } | null;
  completed?: boolean;
  interview_status?: string;
  interviewer_present?: boolean;
}

export interface QuestionCounts {
  resume_technical: number;
  technical_knowledge: number;
  project_defense: number;
  scenario: number;
}

export interface AIPlanConfig {
  target_role?: string | null;
  difficulty?: 'junior' | 'mid' | 'senior' | null;
  question_counts: QuestionCounts;
  enable_resume_questions: boolean;
  enable_technical_questions: boolean;
  enable_project_defense: boolean;
  enable_scenarios: boolean;
  max_follow_ups_per_question: number;
  speech_to_text_enabled: boolean;
  typed_answers_allowed: boolean;
}

export interface AIPlan {
  id: string;
  status: PlanStatus;
  error: string | null;
  role: string;
  difficulty: string;
  configuration: {
    requested: AIPlanConfig;
    effective_counts?: QuestionCounts;
    adjustments?: string[];
    resume_analysis_used?: boolean;
  };
  rubric_version: string;
  model_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  completion_reason: string | null;
  consent: { ai_disclosure_acknowledged: boolean; transcription_consent: boolean | null };
  version: number;
  questions: AIQuestion[];
}

export interface DimensionProgress {
  dimension: DimensionKey;
  label: string;
  average: number | null;
  evaluated_answers: number;
  awaiting_evaluation: number;
  needs_review: number;
  insufficient_data: number;
  evaluation_failed: number;
  evidence_status: 'not_enough_evidence' | 'limited_evidence' | 'sufficient_evidence';
  review_status: 'ok' | 'needs_review';
  latest_evidence: { question: string; rationale: string | null; excerpt: string | null; score: number } | null;
}

export interface AssessmentProgress {
  provisional: boolean;
  rubric_version: string;
  plan_status: PlanStatus;
  dimensions: DimensionProgress[];
  questions: {
    planned_main: number;
    follow_ups: number;
    answered: number;
    evaluated: number;
    awaiting_evaluation: number;
    evaluation_failed: number;
    skipped: number;
    remaining: number;
  };
}

export interface ResumeClaim {
  id: string;
  claim: string;
  category: string;
  technologies: string[];
  source_text: string;
  page: number | null;
  section: string | null;
  source_verified: boolean;
  needs_clarification: boolean;
  clarification_reason: string | null;
  verification_questions: string[];
}

export interface ResumeAnalysis {
  id?: string;
  status: 'not_started' | 'processing' | 'completed' | 'failed';
  error?: string | null;
  has_resume: boolean;
  stale?: boolean;
  resume_filename?: string;
  profile?: {
    candidate_name: string | null;
    experience_level: string;
    experience_summary: string | null;
    skills: string[];
    tools_and_frameworks: string[];
    certifications: string[];
    projects: { name: string; description: string; technologies: string[]; stated_role: string | null; source_verified?: boolean }[];
    employment: { organization: string; title: string; dates: string | null; is_internship: boolean }[];
    education: { institution: string; qualification: string; field_of_study: string | null; dates: string | null }[];
    embedded_instructions_detected: boolean;
  } | null;
  claims?: ResumeClaim[];
  stats?: { pages: number; truncated: boolean; unverified_claims: number; redactions: Record<string, number> } | null;
  model_name?: string | null;
  updated_at?: string | null;
}

export interface ReportQuestion {
  label: string;
  question_id: string;
  category_label: string;
  text: string;
  is_follow_up: boolean;
  status: string;
  asked: boolean;
  skip_reason: string | null;
  source_claim: SourceClaim | null;
  answer_id: string | null;
  capture_method: 'typed' | 'voice' | null;
  transcript: string | null;
  verbatim_transcript: string | null;
  transcript_edited: boolean;
  transcript_flag_note: string | null;
  evaluation_status: string | null;
  evaluations: AIEvaluation[];
  missing_evidence: string[];
  follow_up: { label: string; text: string } | null;
  next_action: { decision: string; reason: string } | null;
  review_flags: string[];
}

export interface AssessmentReport {
  id: string;
  interview_id: string;
  report_version: number;
  status: 'generating' | 'ready' | 'partial' | 'failed';
  error: string | null;
  candidate_info: Record<string, any> | null;
  executive_summary: {
    text: string;
    topics_covered: string[];
    skills_demonstrated: { text: string; question_refs: string[] }[];
    limited_evidence_areas: string[];
    technical_observations: { text: string; question_refs: string[] }[];
    items_requiring_follow_up: string[];
  } | null;
  dimension_scores: DimensionProgress[];
  aggregate: {
    value: number | null;
    scale: string;
    formula: string;
    weights: Record<string, number>;
    contributing: { dimension: string; label: string; average: number; weight: number; answers: number }[];
    excluded: { dimension: string; label: string; reason: string }[];
  } | null;
  question_analysis: ReportQuestion[];
  strengths: { strength: string; question_refs: string[]; evidence_excerpt: string }[];
  areas_for_follow_up: { area: string; reason: string; kind: string; question_refs: string[]; source: string }[];
  suggested_questions: { question: string; rationale: string }[];
  claim_verification: {
    note: string;
    items: {
      claim_id: string;
      claim: string;
      category: string;
      source_text: string | null;
      page: number | null;
      section: string | null;
      source_verified: boolean;
      resume_needs_clarification: boolean;
      explored: boolean;
      question_refs: string[];
      interview_status: string;
      note: string | null;
    }[];
  } | null;
  limitations: string[];
  rubric_version: string;
  model_name: string | null;
  generated_at: string | null;
  hr_review: {
    reviewer_name: string | null;
    reviewed_at: string | null;
    notes: string | null;
    clarifications: string | null;
    next_step: string | null;
    decision: string | null;
  };
  version: number;
  available_versions?: number[];
}

export interface AIConfigInfo {
  configured: boolean;
  model: string;
  transcription_model: string;
  rubric_version: string;
  roles: { key: string; label: string }[];
  max_audio_seconds: number;
}

export const DEFAULT_PLAN_CONFIG: AIPlanConfig = {
  question_counts: { resume_technical: 2, technical_knowledge: 2, project_defense: 2, scenario: 2 },
  enable_resume_questions: true,
  enable_technical_questions: true,
  enable_project_defense: true,
  enable_scenarios: true,
  max_follow_ups_per_question: 1,
  speech_to_text_enabled: true,
  typed_answers_allowed: true,
};
