import { api } from './api';
import type {
  AIConfigInfo, AIPlan, AIPlanConfig, AssessmentProgress, AssessmentReport, AIEvaluation, CurrentAIState,
  ResumeAnalysis,
} from '../types/ai';

const as = (token?: string | null) => (token ? { headers: { 'X-Invitation-Token': token } } : {});

export const getAIConfig = async () => (await api.get<AIConfigInfo>('/ai/config')).data;

export const getResumeAnalysis = async (candidateId: string) =>
  (await api.get<ResumeAnalysis>(`/candidates/${candidateId}/resume-analysis`)).data;

export const requestResumeAnalysis = async (candidateId: string, force = false) =>
  (await api.post<ResumeAnalysis>(`/candidates/${candidateId}/resume-analysis`, { force })).data;

export const getAIPlan = async (interviewId: string) =>
  (await api.get<AIPlan | { status: 'not_configured' }>(`/interviews/${interviewId}/ai-plan`)).data;

export const createAIPlan = async (interviewId: string, config: AIPlanConfig, regenerate = false) =>
  (await api.post<AIPlan>(`/interviews/${interviewId}/ai-plan`, { config, regenerate })).data;

// Polled endpoints: the backend sends ETags, so unchanged polls are answered from the browser cache (304).
export const getCurrentQuestion = async (interviewId: string, token?: string | null) =>
  (await api.get<CurrentAIState>(`/interviews/${interviewId}/questions/current`, as(token))).data;

export const getAssessmentProgress = async (interviewId: string) =>
  (await api.get<AssessmentProgress>(`/interviews/${interviewId}/assessment-progress`)).data;

export const controlQuestions = async (interviewId: string, action: 'start' | 'advance' | 'skip', reason?: string, version?: number) =>
  (await api.post<CurrentAIState>(`/interviews/${interviewId}/questions/next`, { action, reason, version })).data;

export const recordConsent = async (interviewId: string, token: string, transcriptionConsent: boolean) =>
  (await api.post<CurrentAIState>(`/interviews/${interviewId}/ai-consent`,
    { acknowledge_ai_disclosure: true, transcription_consent: transcriptionConsent }, as(token))).data;

export const transcribeAnswer = async (interviewId: string, questionId: string, token: string, audio: Blob, durationSeconds: number) => {
  const form = new FormData();
  const ext = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm';
  form.append('audio', audio, `answer.${ext}`);
  form.append('duration_seconds', durationSeconds.toFixed(1));
  return (await api.post<CurrentAIState>(`/interviews/${interviewId}/questions/${questionId}/transcribe`, form, as(token))).data;
};

export interface AnswerPayload {
  answer_text: string;
  capture_method: 'typed' | 'voice';
  transcript_flagged?: boolean;
  transcript_flag_note?: string;
  idempotency_key: string;
}

export const submitAnswer = async (interviewId: string, questionId: string, token: string, payload: AnswerPayload) =>
  (await api.post<CurrentAIState>(`/interviews/${interviewId}/questions/${questionId}/answer`, payload, as(token))).data;

export const retryEvaluation = async (interviewId: string, questionId: string) =>
  (await api.post(`/interviews/${interviewId}/questions/${questionId}/evaluate`)).data;

export const flagTranscript = async (interviewId: string, questionId: string, note: string) =>
  (await api.post(`/interviews/${interviewId}/questions/${questionId}/transcript-flag`, { flagged: true, note })).data;

export const completeAIInterview = async (interviewId: string) =>
  (await api.post<CurrentAIState>(`/interviews/${interviewId}/ai-complete`)).data;

// Saves the report PDF (built by the backend from the saved report, including the HR review).
export const downloadReportPdf = async (interviewId: string, version: number, candidateName: string) => {
  const res = await api.get(`/interviews/${interviewId}/report/pdf`, { params: { version }, responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `CandidateLens_Report_${(candidateName || 'candidate').replace(/[^A-Za-z0-9]+/g, '_')}_v${version}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
};

export const getReport = async (interviewId: string, version?: number) =>
  (await api.get<AssessmentReport>(`/interviews/${interviewId}/report`, { params: version ? { version } : {} })).data;

export const generateReport = async (interviewId: string) =>
  (await api.post<AssessmentReport>(`/interviews/${interviewId}/report/generate`)).data;

export interface ReportReviewPayload {
  hr_notes?: string | null;
  hr_clarifications?: string | null;
  hr_next_step?: string | null;
  hr_decision?: string | null;
  version?: number;
}

export const reviewReport = async (reportId: string, payload: ReportReviewPayload) =>
  (await api.patch<AssessmentReport>(`/reports/${reportId}/review`, payload)).data;

export const reviewEvaluation = async (
  interviewId: string, answerId: string,
  payload: { dimension: string; action: 'override' | 'mark_needs_review' | 'confirm'; score?: number; note: string },
) => (await api.post<AIEvaluation>(`/interviews/${interviewId}/answers/${answerId}/evaluations/review`, payload)).data;

// Stable per question so a retried submit after a network error is recognised as the same answer.
export const idempotencyKeyFor = (questionId: string): string => {
  const storageKey = `cl_answer_key_${questionId}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const key = crypto.randomUUID().replace(/-/g, '');
    sessionStorage.setItem(storageKey, key);
    return key;
  } catch {
    return `${questionId.replace(/-/g, '')}`.slice(0, 32);
  }
};
