import React, { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Loader2, ShieldCheck, Sparkles, StickyNote, Video, Volume2 } from 'lucide-react';
import { Track } from 'livekit-client';
import ResumePanel from '../components/interview-room/ResumePanel';
import InterviewDetailsPanel, { type NotesSaveState } from '../components/interview-room/InterviewDetailsPanel';
import VideoCallControls from '../components/interview-room/VideoCallControls';
import VideoTile from '../components/interview-room/VideoTile';
import AIInterviewerPanel from '../components/ai/AIInterviewerPanel';
import CandidateQuestionPanel from '../components/ai/CandidateQuestionPanel';
import { useAIInterview } from '../hooks/useAIInterview';
import { getResumeAnalysis } from '../services/ai';
import type { ResumeAnalysis } from '../types/ai';
import { useLiveKitRoom, type CallPhase } from '../hooks/useLiveKitRoom';
import {
  captureInvitationToken,
  endInterview,
  fetchResumeObjectUrl,
  getCandidate,
  getErrorMessage,
  getInterview,
  isConflict,
  joinInterview,
  saveInterviewNotes,
  sendPresence,
  startInterview,
} from '../services/interviews';
import type { CandidateDetail, Interview } from '../types/interview';
import { formatDateTime, formatElapsed } from '../utils/datetime';

const POLL_MS = 5000;
const NOTES_DEBOUNCE_MS = 1000;
const CLOSED_STATUSES = ['completed', 'cancelled', 'expired', 'failed', 'declined'];

const PHASE_LABELS: Record<CallPhase, string> = {
  idle: 'Not connected',
  requesting: 'Requesting access…',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
  error: 'Connection failed',
};

const CLOSED_MESSAGES: Record<string, string> = {
  completed: 'This interview has ended.',
  cancelled: 'This interview was cancelled.',
  expired: 'This interview has expired.',
  failed: 'This interview could not be completed.',
  declined: 'The candidate declined this interview.',
};

interface InterviewRoomPageProps {
  user: any;
}

const InterviewRoomPage: React.FC<InterviewRoomPageProps> = ({ user }) => {
  const { interviewId = '' } = useParams();
  const [token] = useState(() => captureInvitationToken(interviewId));
  if (!token && !user) return <Navigate to="/login" replace />;
  return <InterviewRoom interviewId={interviewId} invitationToken={token} />;
};

interface InterviewRoomProps {
  interviewId: string;
  invitationToken: string | null;
}

const InterviewRoom: React.FC<InterviewRoomProps> = ({ interviewId, invitationToken }) => {
  const isCandidateView = !!invitationToken;
  const call = useLiveKitRoom();

  const [interview, setInterview] = useState<Interview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [optimistic, applyOptimistic] = useOptimistic(interview, (_: Interview | null, next: Interview) => next);

  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState('');

  const [notes, setNotes] = useState('');
  const [notesState, setNotesState] = useState<NotesSaveState>('idle');
  const notesTimer = useRef<number | undefined>(undefined);
  const lastSavedNotes = useRef<string | null>(null);
  const latestNotes = useRef('');

  const [now, setNow] = useState(Date.now());
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [rightTab, setRightTab] = useState<'ai' | 'notes'>('ai');

  // AI interviewer state is server-owned; poll only while the session can host it.
  const aiEnabled = !!interview && ['accepted', 'in_progress', 'completed'].includes(interview.status);
  const ai = useAIInterview(interviewId, {
    role: isCandidateView ? 'candidate' : 'hr', token: invitationToken, enabled: aiEnabled,
  });

  const load = useCallback(async () => {
    const data = await getInterview(interviewId, invitationToken);
    setInterview(data);
    if (lastSavedNotes.current === null && data.is_interviewer) {
      lastSavedNotes.current = data.notes || '';
      latestNotes.current = data.notes || '';
      setNotes(data.notes || '');
    }
    return data;
  }, [interviewId, invitationToken]);

  useEffect(() => {
    load().catch((err) => setLoadError(
      err?.response?.status === 403 ? 'You are not a participant in this interview.'
        : err?.response?.status === 404 ? 'Interview not found.'
          : getErrorMessage(err, 'Failed to load the interview.'),
    ));
  }, [load]);

  // The backend owns the session state; poll it so both sides see starts, ends and cancellations.
  useEffect(() => {
    if (!interview || CLOSED_STATUSES.includes(interview.status)) return;
    const timer = window.setInterval(() => { load().catch(() => undefined); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [interview?.status, load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Interviewer: load candidate profile and resume for the left panel.
  useEffect(() => {
    if (!interview?.is_interviewer || candidate) return;
    let revoked: string | null = null;
    (async () => {
      try {
        const c = await getCandidate(interview.candidate_id);
        setCandidate(c);
        getResumeAnalysis(c.id).then(setAnalysis).catch(() => undefined);
        if (c.resume) {
          setResumeLoading(true);
          revoked = await fetchResumeObjectUrl(c.id, c.resume.file_type);
          setResumeUrl(revoked);
        }
      } catch {
        setResumeError('Failed to load the resume.');
      } finally {
        setResumeLoading(false);
      }
    })();
    return () => { if (revoked) window.URL.revokeObjectURL(revoked); };
  }, [interview?.is_interviewer, interview?.candidate_id]);

  // If the backend closes the session, leave the video room too.
  useEffect(() => {
    if (optimistic && CLOSED_STATUSES.includes(optimistic.status) && (call.phase === 'connected' || call.phase === 'reconnecting')) {
      call.disconnect();
    }
  }, [optimistic?.status, call.phase]);

  // Warn before closing the tab mid-call.
  useEffect(() => {
    if (call.phase !== 'connected') return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [call.phase]);

  const persistNotes = useCallback(async (value: string) => {
    // null means notes were never loaded, i.e. this viewer is not the interviewer.
    if (lastSavedNotes.current === null || value === lastSavedNotes.current) return;
    setNotesState('saving');
    try {
      const updated = await saveInterviewNotes(interviewId, value);
      lastSavedNotes.current = value;
      setInterview(updated);
      setNotesState(latestNotes.current === value ? 'saved' : 'saving');
    } catch {
      setNotesState('error');
    }
  }, [interviewId]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    latestNotes.current = value;
    setNotesState('saving');
    window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => persistNotes(value), NOTES_DEBOUNCE_MS);
  };

  const flushNotes = () => {
    window.clearTimeout(notesTimer.current);
    persistNotes(latestNotes.current);
  };

  useEffect(() => () => {
    window.clearTimeout(notesTimer.current);
    if (lastSavedNotes.current !== null && latestNotes.current !== lastSavedNotes.current) {
      saveInterviewNotes(interviewId, latestNotes.current).catch(() => undefined);
    }
  }, [interviewId]);

  // Interviewer heartbeat while in the call. Deliberately not paused in background tabs:
  // if it stops, the candidate's answers pause and the session ends after a grace period.
  const hrLive = !isCandidateView && (call.phase === 'connected' || call.phase === 'reconnecting')
    && !!interview && ['accepted', 'in_progress'].includes(interview.status);
  useEffect(() => {
    if (!hrLive) return;
    const beat = () => { sendPresence(interviewId).catch(() => undefined); };
    beat();
    const t = window.setInterval(beat, 10000);
    return () => window.clearInterval(t);
  }, [hrLive, interviewId]);

  const handleLeave = async () => {
    flushNotes();
    if (!isCandidateView && interview?.status === 'in_progress') {
      if (!window.confirm('Leaving ends this interview for the candidate. You can schedule a re-interview afterwards. Leave and end the interview?')) return;
      try {
        setInterview(await endInterview(interview.id, 'interviewer_left'));
      } catch (err) {
        setActionError(getErrorMessage(err, 'Failed to end the interview.'));
        return;
      }
    }
    await call.disconnect();
  };

  const handleJoin = async () => {
    setActionError('');
    const access = await call.connect(() => joinInterview(interviewId, invitationToken));
    if (access) setInterview(access.interview);
    else load().catch(() => undefined);
  };

  const handleStart = () => {
    if (!interview) return;
    setActionError('');
    startTransition(async () => {
      applyOptimistic({ ...interview, status: 'in_progress', display_status: 'in_progress', started_at: new Date().toISOString() });
      try {
        const updated = await startInterview(interview.id, interview.version);
        startTransition(() => setInterview(updated));
      } catch (err) {
        setActionError(getErrorMessage(err, 'Failed to start the interview.'));
        if (isConflict(err)) load().catch(() => undefined);
      }
    });
  };

  const handleEnd = () => {
    if (!interview) return;
    if (!window.confirm('End this interview for both participants?')) return;
    setActionError('');
    flushNotes();
    startTransition(async () => {
      applyOptimistic({ ...interview, status: 'completed', display_status: 'completed', ended_at: new Date().toISOString(), can_join: false });
      try {
        const updated = await endInterview(interview.id);
        startTransition(() => setInterview(updated));
        await call.disconnect();
      } catch (err) {
        setActionError(getErrorMessage(err, 'Failed to end the interview.'));
        load().catch(() => undefined);
      }
    });
  };

  if (loadError) {
    return (
      <div className="login-container">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div className="login-title">CandidateLens</div>
          <p className="error-message" role="alert">{loadError}</p>
          {isCandidateView ? null : <Link to="/dashboard">Back to dashboard</Link>}
        </div>
      </div>
    );
  }

  if (!optimistic) {
    return <div className="login-container"><div className="login-card" style={{ textAlign: 'center' }}>Loading interview room…</div></div>;
  }

  const i = optimistic;
  const isInterviewer = i.is_interviewer;
  const inCall = call.phase === 'connected' || call.phase === 'reconnecting';
  const busy = call.phase === 'requesting' || call.phase === 'connecting';
  const local = call.localParticipant;
  const remotes = call.remoteParticipants;
  const remoteName = isInterviewer ? i.candidate_name : (i.interviewer_name || 'Interviewer');
  const backLink = isInterviewer ? `/candidates/${i.candidate_id}` : `/interviews/${i.id}/invitation`;
  const endedEarly = i.status === 'completed' && (i.end_reason === 'interviewer_left' || i.end_reason === 'interviewer_disconnected');
  const closedMessage = endedEarly
    ? (isInterviewer
      ? (i.end_reason === 'interviewer_left'
        ? 'You left the call, so this interview ended early. You can schedule a re-interview from the candidate profile.'
        : 'You were disconnected for too long, so this interview ended early. You can schedule a re-interview from the candidate profile.')
      : 'The interview has ended. Your interviewer will contact you about the next steps.')
    : CLOSED_MESSAGES[i.status];

  const waitingText = call.remoteHasLeft
    ? `${remoteName} left the call. Waiting for them to rejoin…`
    : `Waiting for ${remoteName} to join…`;

  const renderPreJoin = () => {
    if (closedMessage) {
      return (
        <div className="prejoin">
          <h2>{closedMessage}</h2>
          {i.ended_at && <p className="hint">Ended {formatDateTime(i.ended_at)}</p>}
          <Link to={backLink} className="btn-secondary-sm" style={{ marginTop: '1rem' }}>
            {isInterviewer ? 'Back to candidate profile' : 'Back to invitation'}
          </Link>
        </div>
      );
    }
    if (busy) {
      return (
        <div className="prejoin">
          <Loader2 size={32} className="spin" />
          <h2>{PHASE_LABELS[call.phase]}</h2>
          <p className="hint">Your browser may ask for camera and microphone permission.</p>
        </div>
      );
    }
    if (!i.can_join) {
      return (
        <div className="prejoin">
          <h2>The room isn't open yet</h2>
          <p className="hint">
            {i.status === 'request_pending'
              ? 'The candidate has not accepted the invitation yet.'
              : `You can join from ${formatDateTime(i.join_opens_at)}.`}
          </p>
        </div>
      );
    }
    return (
      <div className="prejoin">
        <Video size={36} color="var(--primary-color)" />
        <h2>{call.phase === 'disconnected' ? 'You are not in the call' : 'Ready to join?'}</h2>
        {call.endedMessage && <p className="hint">{call.endedMessage}</p>}
        {call.error && <p className="error-message" role="alert">{call.error}</p>}
        <button className="btn-primary" style={{ maxWidth: 260 }} onClick={handleJoin}>
          {call.phase === 'disconnected' || call.phase === 'error' ? 'Rejoin interview' : 'Join interview'}
        </button>
        <p className="hint" style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={14} /> {isCandidateView
            ? 'Keep your camera and microphone on for the whole interview. Audio and video are not recorded.'
            : 'Your camera and microphone are used only for this live call. Audio and video are not recorded.'}
        </p>
      </div>
    );
  };

  const micPub = local?.getTrackPublication(Track.Source.Microphone);
  const micTrack = micPub?.track?.mediaStreamTrack;
  const profile = analysis?.status === 'completed' ? analysis.profile : null;

  const elapsed = i.started_at && i.status === 'in_progress'
    ? formatElapsed(i.started_at, now)
    : i.status === 'in_progress' ? '00:00' : null;

  return (
    <div className="room-layout">
      <header className="room-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
          <Link to={backLink} className="back-link" style={{ margin: 0 }} aria-label="Back"><ArrowLeft size={16} /></Link>
          <div className="nav-brand" style={{ fontSize: '1.125rem' }}>CandidateLens</div>
          <div className="room-title truncate">{i.candidate_name} · {i.target_role}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className={`conn-chip conn-${call.phase}`} role="status">{PHASE_LABELS[call.phase]}</span>
          <span className="elapsed" title="Interview elapsed time">
            <Clock size={14} /> {elapsed ?? 'Not started'}
          </span>
        </div>
      </header>

      <div className={`room-grid ${isInterviewer ? 'room-grid-3' : 'room-grid-2'}`}>
        {isInterviewer && (
          <ResumePanel
            candidate={candidate} resumeUrl={resumeUrl} loading={resumeLoading} error={resumeError}
            analysisStatus={analysis?.status}
            skills={profile ? [...new Set([...profile.skills, ...profile.tools_and_frameworks])] : undefined}
            projects={profile?.projects.map((p) => ({ name: p.name, summary: p.description }))}
            focus={ai.state?.question?.source_claim}
          />
        )}

        <section className="room-center" aria-label="Video call">
          <div className="video-stage">
            {inCall ? (
              <>
                {remotes.length > 0 ? (
                  remotes.map((p) => (
                    <VideoTile key={p.identity} participant={p} label={p.name || remoteName} placeholder={waitingText} />
                  ))
                ) : (
                  <VideoTile label={remoteName} placeholder={waitingText} />
                )}
                <div className="local-tile">
                  <VideoTile participant={local} label={local?.name || 'You'} isLocal compact placeholder="Starting camera…" />
                </div>
              </>
            ) : (
              renderPreJoin()
            )}
          </div>

          {call.phase === 'reconnecting' && <div className="notice notice-warn">Connection interrupted. Reconnecting…</div>}
          {inCall && !call.canPlayAudio && (
            <button className="notice notice-info" onClick={call.startAudio}>
              <Volume2 size={16} /> Your browser blocked audio. Click to hear the other participant.
            </button>
          )}
          {inCall && call.mediaIssues.map((issue) => (
            <div key={issue.kind} className="notice notice-warn" role="alert">{issue.message}</div>
          ))}
          {actionError && <div className="notice notice-error" role="alert">{actionError}</div>}
          {inCall && isInterviewer && i.status === 'request_pending' && (
            <div className="notice notice-info">The candidate hasn't accepted yet. You can start once they accept.</div>
          )}

          {inCall && (
            <VideoCallControls
              micOn={!!local?.isMicrophoneEnabled}
              cameraOn={!!local?.isCameraEnabled}
              onToggleMic={() => call.setDevice('microphone', !local?.isMicrophoneEnabled)}
              onToggleCamera={() => call.setDevice('camera', !local?.isCameraEnabled)}
              onLeave={handleLeave}
              canStart={isInterviewer && i.status === 'accepted'}
              canEnd={isInterviewer && i.status === 'in_progress'}
              busy={isPending}
              onStart={handleStart}
              onEnd={handleEnd}
            />
          )}
        </section>

        <aside className="room-panel room-panel-right" aria-label={isInterviewer ? 'AI interviewer and notes' : 'Interview questions'}>
          {isInterviewer ? (
            <>
              <div className="panel-tabs" role="tablist">
                <button role="tab" aria-selected={rightTab === 'ai'} className={rightTab === 'ai' ? 'active' : ''} onClick={() => setRightTab('ai')}>
                  <Sparkles size={14} /> AI interviewer
                </button>
                <button role="tab" aria-selected={rightTab === 'notes'} className={rightTab === 'notes' ? 'active' : ''} onClick={() => setRightTab('notes')}>
                  <StickyNote size={14} /> Notes & details
                </button>
              </div>
              {rightTab === 'ai' ? (
                <div className="room-panel-section">
                  {ai.error && <div className="hint text-warn">{ai.error}</div>}
                  <AIInterviewerPanel
                    interviewId={i.id} interviewStatus={interview?.status ?? i.status /* confirmed, not optimistic */} targetRole={i.target_role} durationMinutes={i.duration_minutes}
                    state={ai.state} progress={ai.progress} onState={ai.setState} refresh={ai.refresh}
                  />
                </div>
              ) : (
                <InterviewDetailsPanel
                  interview={i}
                  statusPending={isPending}
                  notes={notes}
                  notesState={notesState}
                  onNotesChange={handleNotesChange}
                  onNotesBlur={flushNotes}
                />
              )}
            </>
          ) : (
            <>
              <div className="room-panel-section">
                {ai.error && <div className="hint text-warn">{ai.error}</div>}
                <CandidateQuestionPanel
                  interviewId={i.id} token={invitationToken!} state={ai.state} onState={ai.setState}
                  micTrack={micTrack} micMuted={!micPub || micPub.isMuted} inCall={inCall}
                  cameraOn={!!local?.isCameraEnabled}
                />
              </div>
              <InterviewDetailsPanel interview={i} statusPending={isPending} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
};

export default InterviewRoomPage;
