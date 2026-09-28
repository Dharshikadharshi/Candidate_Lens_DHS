import React, { useCallback, useEffect, useOptimistic, useState, useTransition } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Calendar, CheckCircle, Clock, User, Video, XCircle } from 'lucide-react';
import InterviewStatusBadge from '../components/InterviewStatusBadge';
import { captureInvitationToken, getErrorMessage, getInterview, isConflict, respondToInterview } from '../services/interviews';
import type { Interview } from '../types/interview';
import { formatDateTime, localTimeZoneLabel } from '../utils/datetime';
import { INTERVIEW_RULES } from '../components/ai/CandidateQuestionPanel';

const POLL_MS = 15000;

const CLOSED_MESSAGES: Record<string, string> = {
  cancelled: 'This interview has been cancelled by the interviewer.',
  expired: 'This invitation has expired.',
  completed: 'This interview has been completed. Thank you for your time.',
  failed: 'This interview could not be completed. The interviewer will contact you.',
};

const CandidateInvitationPage: React.FC = () => {
  const { interviewId = '' } = useParams();
  const navigate = useNavigate();
  const [token] = useState(() => captureInvitationToken(interviewId));
  const [interview, setInterview] = useState<Interview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [optimistic, applyOptimistic] = useOptimistic(interview, (_: Interview | null, next: Interview) => next);

  const load = useCallback(async () => {
    if (!token) return;
    const data = await getInterview(interviewId, token);
    setInterview(data);
  }, [interviewId, token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setLoadError('This invitation link is incomplete. Please open the full link you received.');
      return;
    }
    load()
      .catch((err) => setLoadError(
        err?.response?.status === 403 || err?.response?.status === 404
          ? 'This invitation link is not valid. It may have been replaced by a newer link.'
          : getErrorMessage(err, 'Failed to load your invitation.'),
      ))
      .finally(() => setLoading(false));
  }, [load, token]);

  // Keep the page current so the Join button appears when the room opens.
  useEffect(() => {
    if (!interview || !['request_pending', 'accepted', 'in_progress'].includes(interview.status)) return;
    const timer = window.setInterval(() => { load().catch(() => undefined); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [interview?.status, load]);

  const respond = (response: 'accept' | 'decline') => {
    if (!interview || !token) return;
    if (response === 'decline' && !window.confirm('Decline this interview invitation?')) return;
    setActionError('');
    startTransition(async () => {
      applyOptimistic({
        ...interview,
        status: response === 'accept' ? 'accepted' : 'declined',
        display_status: response === 'accept' ? 'accepted' : 'declined',
      });
      try {
        const updated = await respondToInterview(interview.id, response, interview.version, token);
        startTransition(() => setInterview(updated));
      } catch (err) {
        setActionError(getErrorMessage(err, 'Failed to send your response. Please try again.'));
        if (isConflict(err)) load().catch(() => undefined);
      }
    });
  };

  if (loading) {
    return <div className="login-container"><div className="login-card" style={{ textAlign: 'center' }}>Loading your invitation...</div></div>;
  }

  if (loadError || !optimistic) {
    return (
      <div className="login-container">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div className="login-title">CandidateLens</div>
          <p className="error-message" role="alert">{loadError || 'Invitation not found.'}</p>
        </div>
      </div>
    );
  }

  const i = optimistic;
  const closedMessage = CLOSED_MESSAGES[i.status];

  return (
    <div className="login-container" style={{ padding: '16px' }}>
      <div className="login-card" style={{ maxWidth: '520px' }}>
        <div className="login-header" style={{ marginBottom: '1.25rem' }}>
          <div className="login-title">CandidateLens</div>
          <div className="login-subtitle">Interview invitation</div>
        </div>

        <h1 style={{ fontSize: '1.25rem', marginBottom: '4px' }}>Hi {i.candidate_name},</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          You're invited to an <strong>HR screening interview</strong> (live video) for the <strong>{i.target_role}</strong> role.
        </p>

        <dl className="detail-list" style={{ marginBottom: '1.25rem' }}>
          <div><dt><User size={14} /> Interviewer</dt><dd>{i.interviewer_name || 'CandidateLens HR'}</dd></div>
          <div><dt><Calendar size={14} /> When</dt><dd>{i.is_instant ? 'Now' : formatDateTime(i.scheduled_at)}</dd></div>
          <div><dt><Clock size={14} /> Duration</dt><dd>{i.duration_minutes} minutes</dd></div>
          <div><dt>Status</dt><dd><InterviewStatusBadge status={i.display_status} pending={isPending} /></dd></div>
        </dl>
        {!i.is_instant && <div className="hint" style={{ marginTop: '-0.75rem', marginBottom: '1rem' }}>Shown in your time zone ({localTimeZoneLabel()}).</div>}

        {i.invitation_message && <p className="quote" style={{ marginBottom: '1.25rem' }}>“{i.invitation_message}”</p>}

        {!CLOSED_MESSAGES[i.status] && i.status !== 'declined' && (
          <div style={{ marginBottom: '1.25rem' }}>
            <div className="room-section-title">Interview guidelines</div>
            <ul className="plain-list" style={{ fontSize: '0.875rem' }}>{INTERVIEW_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}

        {actionError && <div className="error-message" role="alert">{actionError}</div>}

        {closedMessage ? (
          <div className="empty-box">{closedMessage}</div>
        ) : i.status === 'declined' ? (
          <div className="empty-box"><XCircle size={16} style={{ verticalAlign: 'middle' }} /> You declined this invitation. Your response has been recorded.</div>
        ) : i.status === 'request_pending' ? (
          <div className="button-row" style={{ justifyContent: 'stretch' }}>
            <button className="btn-primary" onClick={() => respond('accept')} disabled={isPending} style={{ flex: 1 }}>
              <CheckCircle size={18} style={{ marginRight: 8 }} /> Accept
            </button>
            <button className="btn-secondary-sm" onClick={() => respond('decline')} disabled={isPending} style={{ flex: 1, justifyContent: 'center' }}>
              Decline
            </button>
          </div>
        ) : (
          <div>
            <div className="flash-success" style={{ marginBottom: '1rem' }}>
              <span><CheckCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />You've accepted this interview.</span>
            </div>
            {i.can_join ? (
              <button className="btn-primary" onClick={() => navigate(`/interviews/${i.id}/room`)}>
                <Video size={18} style={{ marginRight: 8 }} /> {i.status === 'in_progress' ? 'Rejoin Interview' : 'Join Interview'}
              </button>
            ) : (
              <div className="hint">
                The interview room opens at {formatDateTime(i.join_opens_at)}. Keep this page open or come back using the same link.
              </div>
            )}
            <p className="hint" style={{ marginTop: '1rem' }}>
              You'll need a working camera and microphone. Audio and video are not recorded.
            </p>
            {!isPending && i.status === 'accepted' && (
              <button className="link-button" onClick={() => respond('decline')}>I can no longer attend</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CandidateInvitationPage;
