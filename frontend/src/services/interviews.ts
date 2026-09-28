import { api } from './api';
import type {
  CandidateDetail,
  Interview,
  InterviewCreated,
  InterviewCreatePayload,
  JoinRoomResponse,
} from '../types/interview';

// Candidates are not logged in: they authenticate with the invitation token from their link.
// When a token is present, the backend ignores any HR bearer token in the same browser.
const authHeaders = (invitationToken?: string | null) =>
  invitationToken ? { headers: { 'X-Invitation-Token': invitationToken } } : {};

export const getCandidate = async (candidateId: string) =>
  (await api.get<CandidateDetail>(`/candidates/${candidateId}`)).data;

export const listCandidateInterviews = async (candidateId: string) =>
  (await api.get<{ items: Interview[]; total: number }>(`/candidates/${candidateId}/interviews`)).data.items;

export const createInterview = async (candidateId: string, payload: InterviewCreatePayload) =>
  (await api.post<InterviewCreated>(`/candidates/${candidateId}/interviews`, payload)).data;

export const getInterview = async (interviewId: string, invitationToken?: string | null) =>
  (await api.get<Interview>(`/interviews/${interviewId}`, authHeaders(invitationToken))).data;

export const respondToInterview = async (
  interviewId: string,
  response: 'accept' | 'decline',
  version: number,
  invitationToken: string,
) =>
  (await api.patch<Interview>(`/interviews/${interviewId}/response`, { response, version }, authHeaders(invitationToken))).data;

export const cancelInterview = async (interviewId: string, version: number) =>
  (await api.patch<Interview>(`/interviews/${interviewId}/cancel`, { version })).data;

export const regenerateInvitationLink = async (interviewId: string) =>
  (await api.post<{ invitation_url: string; invitation_expires_at: string | null }>(`/interviews/${interviewId}/invitation-link`)).data;

export const joinInterview = async (interviewId: string, invitationToken?: string | null) =>
  (await api.post<JoinRoomResponse>(`/interviews/${interviewId}/join`, null, authHeaders(invitationToken))).data;

export const startInterview = async (interviewId: string, version: number) =>
  (await api.post<Interview>(`/interviews/${interviewId}/start`, { version })).data;

// reason "interviewer_left": HR left the call, so the session ends incomplete (re-interview possible).
export const endInterview = async (interviewId: string, reason: 'completed' | 'interviewer_left' = 'completed') =>
  (await api.post<Interview>(`/interviews/${interviewId}/end`, { reason })).data;

// Interviewer heartbeat: without it the candidate cannot continue and the session ends automatically.
export const sendPresence = async (interviewId: string) =>
  (await api.post<{ status: string; recorded: boolean }>(`/interviews/${interviewId}/presence`)).data;

export const saveInterviewNotes = async (interviewId: string, notes: string) =>
  (await api.patch<Interview>(`/interviews/${interviewId}/notes`, { notes })).data;

export const fetchResumeObjectUrl = async (candidateId: string, fileType?: string) => {
  const response = await api.get(`/candidates/${candidateId}/resume/download`, { responseType: 'blob' });
  return window.URL.createObjectURL(new Blob([response.data], { type: fileType || 'application/pdf' }));
};

export const getErrorMessage = (err: any, fallback: string): string => {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg.replace(/^Value error, /, '');
  if (err?.response?.status === 409) return 'This interview was changed elsewhere. Reload to see the latest state.';
  return fallback;
};

export const isConflict = (err: any) => err?.response?.status === 409;

// Keep the raw invitation token out of the address bar once captured.
const tokenKey = (interviewId: string) => `cl_invitation_${interviewId}`;

export const captureInvitationToken = (interviewId: string): string | null => {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  try {
    if (fromUrl) {
      sessionStorage.setItem(tokenKey(interviewId), fromUrl);
      params.delete('token');
      const query = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
      return fromUrl;
    }
    return sessionStorage.getItem(tokenKey(interviewId));
  } catch {
    return fromUrl;
  }
};
