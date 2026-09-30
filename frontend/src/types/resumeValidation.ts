export interface CategoryScore {
  category: string;
  score: number;
  maximum_score: number;
  reasoning_summary?: string;
}

export interface ValidationFinding {
  category: string;
  score: number;
  maximum_score: number;
  finding_description: string;
  relevant_resume_excerpt?: string | null;
  resume_page_or_section?: string | null;
  reasoning_summary?: string | null;
  recommended_action?: string | null;
  review_status?: string | null;
}

export interface SuggestedQuestion {
  category: string;
  priority: string;
  question: string;
  rationale?: string;
}

export interface VerificationSummary {
  contact: string;
  education: string;
  experience: string;
  skills: string;
  projects: string;
  certifications: string;
  github: string;
  linkedin: string;
  portfolio: string;
}

export interface EvidenceItem {
  category: string;
  claim: string;
  evidence: string;
  source: string;
  status: string;
}

export interface InconsistencyItem {
  type: string;
  description: string;
  severity: string;
}

export interface MissingInfoItem {
  item: string;
  status: string;
}

export interface ProjectVerification {
  project_name: string;
  description: string;
  technologies: string[];
  date: string;
  claimed_features: string[];
  claimed_frameworks: string[];
  claimed_models: string[];
  claimed_deployment: string[];
}

export interface GitHubProjectMatch {
  resume_project: string;
  repository: string | null;
  repository_url: string | null;
  status: string;
  confidence: number;
  technology_evidence: string[];
  missing_claims: string[];
  evidence: { source: string; detail: string }[];
}

export interface GitHubProfile {
  status: string;
  message?: string;
  username?: string;
  profile_url?: string;
  public_repositories?: number;
  avatar_url?: string;
}

export interface GitHubVerification {
  profile?: GitHubProfile;
  project_matches?: GitHubProjectMatch[];
  status?: string;
  message?: string;
}

export interface ResumeValidationReport {
  id: string;
  candidate_id: string;
  resume_id?: string;
  target_role: string;
  overall_score?: number;
  validation_status: 'pending' | 'processing' | 'completed' | 'failed';
  rubric_version?: string;
  category_scores: CategoryScore[];
  detailed_findings: ValidationFinding[];
  suggested_questions: SuggestedQuestion[];
  verification_summary?: VerificationSummary;
  validation_pipeline?: any[];
  evidence?: EvidenceItem[];
  inconsistencies?: InconsistencyItem[];
  missing_information?: MissingInfoItem[];
  github_verification?: GitHubVerification;
  linkedin_verification?: any;
  leetcode_verification?: any;
  hackerrank_verification?: any;
  project_verification?: ProjectVerification[];
  model_name?: string;
  prompt_version?: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface ResumeValidationHistoryResponse {
  items: ResumeValidationReport[];
  total: number;
}

export interface StartValidationRequest {
  target_role?: string;
}
