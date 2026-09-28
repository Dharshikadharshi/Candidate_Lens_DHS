export type InterviewStatus =
  | 'request_pending'
  | 'accepted'
  | 'declined'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'failed';

// `scheduled` / `ready` are derived by the backend from an accepted interview's join window.
export type InterviewDisplayStatus = InterviewStatus | 'scheduled' | 'ready';

export interface Interview {
  id: string;
  candidate_id: string;
  candidate_name: string;
  target_role: string;
  interviewer_id: string;
  interviewer_name: string | null;
  scheduled_at: string;
  duration_minutes: number;
  is_instant: boolean;
  status: InterviewStatus;
  display_status: InterviewDisplayStatus;
  invitation_message: string | null;
  invitation_expires_at: string | null;
  join_opens_at: string;
  join_closes_at: string;
  can_join: boolean;
  viewer_role: 'hr' | 'candidate';
  is_interviewer: boolean;
  video_provider: string;
  video_room_id: string | null;
  notes: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  version: number;
  end_reason?: 'completed' | 'interviewer_left' | 'interviewer_disconnected' | string | null;
}

export interface InterviewCreated extends Interview {
  invitation_url: string;
  email_sent: boolean;
  notification_detail: string;
}

export interface InterviewCreatePayload {
  scheduled_at?: string;
  duration_minutes: number;
  message?: string;
  instant?: boolean;
}

export interface JoinRoomResponse {
  provider: string;
  server_url: string;
  room_name: string;
  token: string;
  identity: string;
  role: 'hr' | 'candidate';
  expires_at: string;
  interview: Interview;
}

export interface ResumeInfo {
  id: string;
  original_filename: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
}

export interface CandidateDetail {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  target_role: string;
  status: string;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  resume: ResumeInfo | null;
}

// Phase 3 boundaries: the room renders these once the backend starts producing them.
export interface SuggestedQuestion {
  id: string;
  text: string;
  source?: string;
}

export interface TranscriptSegment {
  id: string;
  speaker: 'hr' | 'candidate';
  text: string;
  at: string;
}

export const ACTIVE_STATUSES: InterviewStatus[] = ['request_pending', 'accepted', 'in_progress'];
