import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { getResumeAnalysis, requestResumeAnalysis } from '../../services/ai';
import { getErrorMessage } from '../../services/interviews';
import type { ResumeAnalysis } from '../../types/ai';

interface ResumeAnalysisCardProps {
  candidateId: string;
  aiConfigured: boolean;
  onAnalysis?: (analysis: ResumeAnalysis) => void;
}

const POLL_MS = 2500;

const ResumeAnalysisCard: React.FC<ResumeAnalysisCardProps> = ({ candidateId, aiConfigured, onAnalysis }) => {
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [showClaims, setShowClaims] = useState(false);

  const apply = (a: ResumeAnalysis) => { setAnalysis(a); onAnalysis?.(a); };

  useEffect(() => {
    getResumeAnalysis(candidateId).then(apply).catch((err) => setError(getErrorMessage(err, 'Failed to load resume analysis.')));
  }, [candidateId]);

  // Keep polling for as long as the job is processing (identical responses must not stop the loop).
  useEffect(() => {
    if (analysis?.status !== 'processing') return;
    const t = window.setInterval(() => { getResumeAnalysis(candidateId).then(apply).catch(() => undefined); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [analysis?.status, candidateId]);

  const start = async (force: boolean) => {
    setStarting(true);
    setError('');
    try {
      apply(await requestResumeAnalysis(candidateId, force));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to start resume analysis.'));
    } finally {
      setStarting(false);
    }
  };

  if (!analysis) return <section className="card"><h2 className="card-title">AI resume analysis</h2><div className="hint">{error || 'Loading…'}</div></section>;

  const profile = analysis.profile;
  const claims = analysis.claims || [];

  return (
    <section className="card" aria-label="AI resume analysis">
      <div className="section-header">
        <h2 className="card-title" style={{ margin: 0 }}>AI resume analysis</h2>
        {analysis.has_resume && aiConfigured && analysis.status !== 'processing' && (
          <button className="btn-secondary-sm" onClick={() => start(analysis.status === 'completed')} disabled={starting}>
            {analysis.status === 'not_started' ? <><Sparkles size={16} /> Analyze resume</> : <><RefreshCw size={16} /> Re-analyze</>}
          </button>
        )}
      </div>

      {!analysis.has_resume && <div className="empty-box">Upload a resume to enable AI analysis and resume-based questions.</div>}
      {analysis.has_resume && !aiConfigured && <div className="empty-box">AI is not configured on the server (OPENAI_API_KEY).</div>}
      {analysis.status === 'not_started' && analysis.has_resume && aiConfigured && (
        <div className="hint">Extracts skills, projects and claims to explore in the interview. Contact details are removed before analysis.</div>
      )}
      {analysis.status === 'processing' && <div className="ai-plan-status"><Loader2 size={16} className="spin" /> Analyzing resume…</div>}
      {analysis.status === 'failed' && <div className="flash-error" role="alert"><span>Analysis failed: {analysis.error}</span></div>}
      {analysis.stale && analysis.status === 'completed' && (
        <div className="notice notice-warn"><AlertTriangle size={16} /> The resume changed since this analysis. Re-analyze to update it.</div>
      )}

      {analysis.status === 'completed' && profile && (
        <div className="analysis-body">
          {profile.experience_summary && <p className="hint">{profile.experience_summary} (experience level: {profile.experience_level.replace(/_/g, ' ')})</p>}
          {profile.skills.length + profile.tools_and_frameworks.length > 0 && (
            <div>
              <div className="room-section-title">Skills & tools</div>
              <div className="chip-row">
                {[...new Set([...profile.skills, ...profile.tools_and_frameworks])].map((s) => <span key={s} className="chip">{s}</span>)}
              </div>
            </div>
          )}
          {profile.projects.length > 0 && (
            <div>
              <div className="room-section-title">Projects</div>
              <ul className="plain-list">
                {profile.projects.map((p) => (
                  <li key={p.name}><strong>{p.name}</strong> — {p.description}{p.technologies.length ? ` (${p.technologies.join(', ')})` : ''}</li>
                ))}
              </ul>
            </div>
          )}
          {profile.embedded_instructions_detected && (
            <div className="notice notice-warn"><AlertTriangle size={16} /> The resume contains text addressed to AI systems. It was ignored.</div>
          )}
          <div>
            <button className="link-button" style={{ marginTop: 0 }} onClick={() => setShowClaims((s) => !s)}>
              {showClaims ? 'Hide' : 'Show'} {claims.length} candidate claims to explore
            </button>
            {showClaims && (
              <ul className="claim-list">
                {claims.map((c) => (
                  <li key={c.id} className={c.source_verified ? '' : 'claim-unverified'}>
                    <div><span className="claim-id">{c.id}</span> {c.claim}
                      {!c.source_verified && <span className="status-badge status-danger" style={{ marginLeft: 6 }}>Source not found — not used</span>}
                      {c.needs_clarification && <span className="status-badge status-awaiting" style={{ marginLeft: 6 }}>Needs clarification</span>}
                    </div>
                    <div className="evidence-quote">“{c.source_text}”{c.section ? ` — ${c.section}` : ''}{c.page ? `, page ${c.page}` : ''}</div>
                    {c.clarification_reason && <div className="hint">{c.clarification_reason}</div>}
                  </li>
                ))}
              </ul>
            )}
            <div className="hint" style={{ marginTop: 6 }}>Claims are candidate-provided and are explored in the interview, not independently verified.</div>
          </div>
        </div>
      )}
      {error && <div className="error-message" role="alert">{error}</div>}
    </section>
  );
};

export default ResumeAnalysisCard;
