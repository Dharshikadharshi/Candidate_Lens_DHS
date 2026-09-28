export type ReviewStatus = 'verified' | 'needs_review' | 'clarification_recommended';
export type SkillStatus = 'supported' | 'unsupported' | 'not_mentioned' | 'indeterminate';

export interface ValidationFinding {
  category: 'completeness' | 'role_relevance' | 'skill_evidence' | 'consistency' | 'readability';
  score: number;
  max_score: number;
  finding_description: string;
  relevant_excerpt?: string | null;
  section_or_page?: string | null;
  reasoning: string;
  recommended_action: string;
  review_status: ReviewStatus;
  source_verified?: boolean;
}

export interface SkillEvidenceItem {
  skill: string;
  status: SkillStatus;
  evidence_excerpt?: string | null;
  section_or_page?: string | null;
  notes?: string | null;
  source_verified?: boolean;
}

export interface CategoryScore {
  score: number;
  max_score: number;
  summary: string;
}

export interface ValidationReport {
  id: string;
  candidate_id: string;
  resume_id?: string | null;
  resume_filename?: string | null;
  target_role: string;
  experience_level?: string | null;
  status: 'not_started' | 'processing' | 'completed' | 'failed';
  overall_score?: number | null;
  category_scores?: {
    completeness?: CategoryScore;
    role_relevance?: CategoryScore;
    skill_evidence?: CategoryScore;
    consistency?: CategoryScore;
    readability?: CategoryScore;
  } | null;
  detailed_findings?: ValidationFinding[] | null;
  skills_evidence_map?: SkillEvidenceItem[] | null;
  suggested_questions?: string[] | null;
  summary?: string | null;
  error?: string | null;
  rubric_version: string;
  model_name?: string | null;
  prompt_version?: string | null;
  version: number;
  created_at?: string | null;
  updated_at?: string | null;
  has_resume: boolean;
}

export interface ValidationReportHistoryItem {
  id: string;
  target_role: string;
  status: string;
  overall_score?: number | null;
  version: number;
  created_at?: string | null;
  resume_filename?: string | null;
}

export interface ValidationHistoryResponse {
  candidate_id: string;
  candidate_name: string;
  has_resume: boolean;
  latest?: ValidationReport | null;
  history: ValidationReportHistoryItem[];
}
