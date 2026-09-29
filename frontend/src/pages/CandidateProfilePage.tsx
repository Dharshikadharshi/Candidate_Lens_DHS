import React, { useCallback, useEffect, useOptimistic, useState, useTransition } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Clock, Copy, FileText, LogOut, Mail, Phone, RefreshCw, Video, Zap } from 'lucide-react';
import InterviewStatusBadge from '../components/InterviewStatusBadge';
import InterviewRequestModal from '../components/InterviewRequestModal';
import ResumePreviewModal from '../components/ResumePreviewModal';
import ResumeAnalysisCard from '../components/ai/ResumeAnalysisCard';
import ResumeValidationCard from '../components/ai/ResumeValidationCard';
import AIPlanSetup from '../components/ai/AIPlanSetup';
import { getAIConfig } from '../services/ai';
import type { AIConfigInfo } from '../types/ai';
import {
  cancelInterview,
  createInterview,
  fetchResumeObjectUrl,
  getCandidate,
  getErrorMessage,
  isConflict,
  listCandidateInterviews,
  regenerateInvitationLink,
} from '../services/interviews';
import type { CandidateDetail, Interview, InterviewCreatePayload } from '../types/interview';
import { ACTIVE_STATUSES } from '../types/interview';
import { formatDate, formatDateTime } from '../utils/datetime';

interface CandidateProfilePageProps {
  user: any;
  onLogout: () => void;
}

type OptimisticInterview = Interview & { _pending?: boolean };

const upsert = (list: OptimisticInterview[], item: OptimisticInterview) => {
  const exists = list.some((i) => i.id === item.id);
  const next = exists ? list.map((i) => (i.id === item.id ? item : i)) : [item, ...list];
  return next.sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());
};

const CANDIDATE_STATUS_LABELS: Record<string, string> = {
  awaiting_assessment: 'Awaiting Assessment',
  assessment_in_progress: 'Assessment In Progress',
  completed: 'Completed',
  report_pending: 'Report Pending',
};

const POLL_MS = 10000;

const CandidateProfilePage: React.FC<CandidateProfilePageProps> = ({ user, onLogout }) => {
  const { candidateId = '' } = useParams();
  const navigate = useNavigate();

  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [interviews, setInterviews] = useState<OptimisticInterview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [flash, setFlash] = useState('');
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [inviteLink, setInviteLink] = useState<{ interviewId: string; url: string; detail?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [aiConfig, setAIConfig] = useState<AIConfigInfo | null>(null);

  useEffect(() => { getAIConfig().then(setAIConfig).catch(() => undefined); }, []);

  const [optimisticInterviews, applyOptimistic] = useOptimistic(
    interviews,
    (state: OptimisticInterview[], item: OptimisticInterview) => upsert(state, item),
  );

  const refreshInterviews = useCallback(async () => {
    const items = await listCandidateInterviews(candidateId);
    setInterviews(items);
  }, [candidateId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [c, items] = await Promise.all([getCandidate(candidateId), listCandidateInterviews(candidateId)]);
        if (cancelled) return;
        setCandidate(c);
        setInterviews(items);
        setLoadError('');
      } catch (err: any) {
        if (!cancelled) {
          setLoadError(err?.response?.status === 404 ? 'Candidate not found.' : getErrorMessage(err, 'Failed to load candidate profile.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [candidateId]);

  const activeInterview = optimisticInterviews.find((i) => ACTIVE_STATUSES.includes(i.status));

  // Poll while an interview is active so HR sees the candidate's response without reloading.
  useEffect(() => {
    if (!activeInterview || activeInterview._pending) return;
    const timer = window.setInterval(() => {
      refreshInterviews().catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeInterview?.id, activeInterview?._pending, refreshInterviews]);

  useEffect(() => () => { if (previewUrl) window.URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const showFlash = (text: string) => {
    setFlash(text);
    window.setTimeout(() => setFlash(''), 4000);
  };

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to logout?')) {
      onLogout();
      navigate('/login');
    }
  };

  const placeholderFor = (payload: InterviewCreatePayload): OptimisticInterview => {
    const scheduled = payload.instant ? new Date().toISOString() : payload.scheduled_at!;
    return {
      id: `pending-${Date.now()}`,
      candidate_id: candidateId,
      candidate_name: candidate?.full_name || '',
      target_role: candidate?.target_role || '',
      interviewer_id: user?.id,
      interviewer_name: user?.name || user?.email,
      scheduled_at: scheduled,
      duration_minutes: payload.duration_minutes,
      is_instant: !!payload.instant,
      status: 'request_pending',
      display_status: 'request_pending',
      invitation_message: payload.message || null,
      invitation_expires_at: null,
      join_opens_at: scheduled,
      join_closes_at: scheduled,
      can_join: false,
      viewer_role: 'hr',
      is_interviewer: true,
      video_provider: 'livekit',
      video_room_id: null,
      notes: null,
      started_at: null,
      ended_at: null,
      created_at: null,
      updated_at: null,
      version: 0,
      _pending: true,
    };
  };

  const submitRequest = (payload: InterviewCreatePayload) => {
    setShowRequestModal(false);
    setActionError('');
    setInviteLink(null);
    startTransition(async () => {
      applyOptimistic(placeholderFor(payload));
      try {
        const created = await createInterview(candidateId, payload);
        startTransition(() => {
          const { invitation_url, email_sent, notification_detail, ...interview } = created;
          setInterviews((prev) => upsert(prev, interview));
          setInviteLink({ interviewId: created.id, url: invitation_url, detail: email_sent ? undefined : notification_detail });
          showFlash(payload.instant ? 'Instant interview created. Share the link, then enter the room.' : 'Interview request created.');
        });
      } catch (err) {
        setActionError(getErrorMessage(err, 'Failed to create interview request.'));
        if (isConflict(err)) refreshInterviews().catch(() => undefined);
      }
    });
  };

  const handleCancel = (interview: Interview) => {
    if (!window.confirm('Cancel this interview? The candidate will no longer be able to join.')) return;
    setActionError('');
    startTransition(async () => {
      applyOptimistic({ ...interview, status: 'cancelled', display_status: 'cancelled', can_join: false, _pending: true });
      try {
        const updated = await cancelInterview(interview.id, interview.version);
        startTransition(() => {
          setInterviews((prev) => upsert(prev, updated));
          if (inviteLink?.interviewId === interview.id) setInviteLink(null);
          showFlash('Interview cancelled.');
        });
      } catch (err) {
        setActionError(getErrorMessage(err, 'Failed to cancel interview.'));
        if (isConflict(err)) refreshInterviews().catch(() => undefined);
      }
    });
  };

  const handleRegenerateLink = async (interview: Interview) => {
    if (!window.confirm('Generate a new invitation link? The previous link will stop working.')) return;
    try {
      setActionError('');
      const res = await regenerateInvitationLink(interview.id);
      setInviteLink({ interviewId: interview.id, url: res.invitation_url, detail: 'Share this new link with the candidate. The old link no longer works.' });
    } catch (err) {
      setActionError(getErrorMessage(err, 'Failed to generate a new link.'));
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy the invitation link:', inviteLink.url);
    }
  };

  const openResumePreview = async () => {
    if (!candidate?.resume) return;
    try {
      setPreviewError('');
      setPreviewUrl(await fetchResumeObjectUrl(candidate.id, candidate.resume.file_type));
    } catch {
      setPreviewError('Failed to load resume preview.');
    }
  };

  const downloadResume = () => {
    if (!previewUrl || !candidate?.resume) return;
    const link = document.createElement('a');
    link.href = previewUrl;
    link.setAttribute('download', candidate.resume.original_filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const nav = (
    <nav className="navbar">
      <Link to="/dashboard" className="nav-brand">CandidateLens</Link>
      <div className="nav-user">
        <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{user?.name || user?.email} (HR)</span>
        <button onClick={handleLogout} className="btn-logout" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <LogOut size={16} /> Logout
        </button>
      </div>
    </nav>
  );

  if (loading) {
    return <div className="dashboard-layout">{nav}<main className="dashboard-content"><div className="empty-state">Loading candidate profile...</div></main></div>;
  }

  if (loadError || !candidate) {
    return (
      <div className="dashboard-layout">
        {nav}
        <main className="dashboard-content">
          <Link to="/dashboard" className="back-link"><ArrowLeft size={16} /> Back to candidates</Link>
          <div className="card empty-state" role="alert">{loadError || 'Candidate not found.'}</div>
        </main>
      </div>
    );
  }

  const latest = optimisticInterviews[0];
  const headlineStatus = activeInterview?.display_status || latest?.display_status || 'not_scheduled';

  return (
    <div className="dashboard-layout">
      {nav}
      <main className="dashboard-content">
        <Link to="/dashboard" className="back-link"><ArrowLeft size={16} /> Back to candidates</Link>

        {flash && (
          <div className="flash-success" role="status">
            <span>{flash}</span>
            <button onClick={() => setFlash('')} aria-label="Dismiss">✕</button>
          </div>
        )}
        {actionError && (
          <div className="flash-error" role="alert">
            <span>{actionError}</span>
            <button onClick={() => setActionError('')} aria-label="Dismiss">✕</button>
          </div>
        )}

        <div className="profile-grid">
          <section className="card">
            <div className="profile-header">
              <div className="avatar" aria-hidden>{candidate.full_name.charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <h1 className="profile-name">{candidate.full_name}</h1>
                <div className="profile-role">{candidate.target_role}</div>
              </div>
            </div>
            <dl className="detail-list">
              <div><dt><Mail size={14} /> Email</dt><dd><a href={`mailto:${candidate.email}`}>{candidate.email}</a></dd></div>
              <div><dt><Phone size={14} /> Contact number</dt><dd>{candidate.phone || '—'}</dd></div>
              <div><dt><Calendar size={14} /> Date added</dt><dd>{formatDate(candidate.created_at)}{candidate.created_by_name ? ` by ${candidate.created_by_name}` : ''}</dd></div>
              <div><dt>Assessment status</dt><dd>{CANDIDATE_STATUS_LABELS[candidate.status] || candidate.status}</dd></div>
              <div><dt>Interview status</dt><dd><InterviewStatusBadge status={headlineStatus} pending={activeInterview?._pending} /></dd></div>
            </dl>
          </section>

          <section className="card">
            <h2 className="card-title">Resume</h2>
            {candidate.resume ? (
              <div className="resume-box">
                <FileText size={28} color="var(--primary-color)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 500 }}>{candidate.resume.original_filename}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {(candidate.resume.file_size / 1024).toFixed(1)} KB • Uploaded {formatDate(candidate.resume.uploaded_at)}
                  </div>
                </div>
                <button className="btn-primary-sm" onClick={openResumePreview}>Preview</button>
              </div>
            ) : (
              <div className="empty-box">No resume uploaded yet. Upload one from the candidate list.</div>
            )}
            {previewError && <div className="error-message" role="alert">{previewError}</div>}
          </section>
        </div>

        <div className="profile-grid" style={{ marginTop: '1.5rem' }}>
          <ResumeAnalysisCard candidateId={candidate.id} aiConfigured={!!aiConfig?.configured} />
          <ResumeValidationCard candidateId={candidate.id} />
        </div>

        <section className="card" style={{ marginTop: '1.5rem' }}>
          <div className="section-header">
            <h2 className="card-title" style={{ margin: 0 }}>Interview</h2>
            <div className="button-row">
              <button
                className="btn-primary-sm"
                onClick={() => setShowRequestModal(true)}
                disabled={!!activeInterview || isPending}
                title={activeInterview ? 'This candidate already has an active interview.' : undefined}
              >
                <Calendar size={16} /> Request Interview
              </button>
              <button
                className="btn-secondary-sm"
                onClick={() => submitRequest({ instant: true, duration_minutes: 30 })}
                disabled={!!activeInterview || isPending}
                title={activeInterview ? 'This candidate already has an active interview.' : 'Create an interview that starts now'}
              >
                <Zap size={16} /> Start Instant Interview
              </button>
            </div>
          </div>

          {activeInterview ? (
            <div className="active-interview">
              <div className="active-interview-main">
                <InterviewStatusBadge status={activeInterview.display_status} pending={activeInterview._pending} />
                <div className="active-interview-when">
                  <Clock size={16} /> {activeInterview.is_instant ? 'Instant interview · ' : ''}{formatDateTime(activeInterview.scheduled_at)} · {activeInterview.duration_minutes} min
                </div>
                {activeInterview.invitation_message && <p className="quote">“{activeInterview.invitation_message}”</p>}
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Interviewer: {activeInterview.interviewer_name || '—'}
                  {activeInterview.status === 'request_pending' && !activeInterview._pending && ' · Waiting for the candidate to respond'}
                </div>
              </div>
              {!activeInterview._pending && activeInterview.is_interviewer && (
                <div className="button-row">
                  {activeInterview.can_join ? (
                    <button className="btn-primary-sm" onClick={() => navigate(`/interviews/${activeInterview.id}/room`)}>
                      <Video size={16} /> {activeInterview.status === 'in_progress' ? 'Rejoin Interview' : 'Join Interview'}
                    </button>
                  ) : activeInterview.status === 'accepted' ? (
                    <span className="hint">Room opens {formatDateTime(activeInterview.join_opens_at)}</span>
                  ) : null}
                  {activeInterview.status !== 'in_progress' && (
                    <>
                      <button className="btn-secondary-sm" onClick={() => handleRegenerateLink(activeInterview)}>
                        <RefreshCw size={16} /> New invitation link
                      </button>
                      <button className="btn-danger-sm" onClick={() => handleCancel(activeInterview)} disabled={isPending}>Cancel</button>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="empty-box">No active interview. Request one to invite {candidate.full_name}.</div>
          )}

          {inviteLink && inviteLink.interviewId === activeInterview?.id && (
            <div className="invite-link-box">
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>Candidate invitation link</div>
              {inviteLink.detail && <div className="hint" style={{ marginBottom: '8px' }}>{inviteLink.detail}</div>}
              <div className="invite-link-row">
                <input className="form-input" readOnly value={inviteLink.url} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
                <button className="btn-primary-sm" onClick={copyLink}><Copy size={16} /> {copied ? 'Copied' : 'Copy'}</button>
              </div>
              <div className="hint" style={{ marginTop: '6px' }}>This link is shown only now. It expires after the interview window closes.</div>
            </div>
          )}

          {activeInterview && !activeInterview._pending && activeInterview.is_interviewer && aiConfig?.configured && (
            <div className="invite-link-box">
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>AI interview setup</div>
              <div className="hint" style={{ marginBottom: '8px' }}>
                Prepare a personalised question plan before the call. The AI asks one question at a time; you stay in control.
              </div>
              <AIPlanSetup
                interviewId={activeInterview.id}
                targetRole={candidate.target_role}
                durationMinutes={activeInterview.duration_minutes}
                roles={aiConfig.roles}
                compact
              />
            </div>
          )}

          {optimisticInterviews.length > 0 && (
            <>
              <h3 className="subsection-title">History</h3>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th>Scheduled</th><th>Duration</th><th>Interviewer</th><th>Status</th><th>Started</th><th>Ended</th><th>AI report</th></tr>
                  </thead>
                  <tbody>
                    {optimisticInterviews.map((i) => (
                      <tr key={i.id}>
                        <td>{formatDateTime(i.scheduled_at)}</td>
                        <td>{i.duration_minutes} min</td>
                        <td>{i.interviewer_name || '—'}</td>
                        <td>
                          <InterviewStatusBadge status={i.display_status} pending={i._pending} />
                          {(i.end_reason === 'interviewer_left' || i.end_reason === 'interviewer_disconnected') && (
                            <div className="hint">
                              Ended early ({i.end_reason === 'interviewer_left' ? 'interviewer left' : 'interviewer disconnected'})
                              {!activeInterview && i.is_interviewer && (
                                <> · <button className="link-button" style={{ marginTop: 0 }} onClick={() => setShowRequestModal(true)}>Re-interview</button></>
                              )}
                            </div>
                          )}
                        </td>
                        <td>{i.started_at ? formatDateTime(i.started_at) : '—'}</td>
                        <td>{i.ended_at ? formatDateTime(i.ended_at) : '—'}</td>
                        <td>{i.is_interviewer && ['in_progress', 'completed'].includes(i.status)
                          ? <Link to={`/interviews/${i.id}/report`}>View report</Link> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>

      {showRequestModal && (
        <InterviewRequestModal candidateName={candidate.full_name} onClose={() => setShowRequestModal(false)} onSubmit={submitRequest} />
      )}

      {previewUrl && candidate.resume && (
        <ResumePreviewModal
          url={previewUrl}
          candidate={candidate}
          onClose={() => setPreviewUrl(null)}
          onDownload={downloadResume}
        />
      )}
    </div>
  );
};

export default CandidateProfilePage;
