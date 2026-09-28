import React, { useEffect, useOptimistic, useState, useTransition } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Download, Loader2, RefreshCw } from 'lucide-react';
import ProvisionalScores from '../components/ai/ProvisionalScores';
import { downloadReportPdf, generateReport, getReport, reviewEvaluation, reviewReport } from '../services/ai';
import { getErrorMessage, isConflict } from '../services/interviews';
import type { AssessmentReport, ReportQuestion } from '../types/ai';
import { formatDateTime } from '../utils/datetime';

const NEXT_STEPS: Record<string, string> = {
  proceed_to_round_1: 'Proceed to Round 1',
  additional_assessment: 'Additional assessment',
  on_hold: 'On hold',
  do_not_proceed: 'Do not proceed',
  undecided: 'Undecided',
};

const CLAIM_STATUS: Record<string, string> = {
  evidence_demonstrated: 'Evidence demonstrated in interview',
  partially_demonstrated: 'Partially demonstrated',
  not_demonstrated_in_interview: 'Not demonstrated in interview',
  needs_human_clarification: 'Needs human clarification',
  explored_not_assessed: 'Explored, not assessed',
  not_explored: 'Not explored (unverified)',
};

const EVIDENCE_STATUS: Record<string, string> = {
  scored: 'Scored', insufficient_data: 'Insufficient data', needs_review: 'Needs review',
};

const POLL_MS = 2500;

const Refs: React.FC<{ refs: string[] }> = ({ refs }) =>
  refs.length ? <span className="refs">{refs.map((r) => <a key={r} href={`#q-${r}`} className="ref-chip">{r}</a>)}</span> : null;

const InterviewReportPage: React.FC = () => {
  const { interviewId = '' } = useParams();
  const [report, setReport] = useState<AssessmentReport | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = async (version?: number) => {
    try {
      const data = await getReport(interviewId, version);
      setReport(data);
      setMissing(false);
      setError('');
    } catch (err: any) {
      if (err?.response?.status === 404) setMissing(true);
      else setError(getErrorMessage(err, 'Failed to load the report.'));
    }
  };

  useEffect(() => {
    load();
  }, [interviewId]);

  useEffect(() => {
    if (report?.status !== 'generating') return;
    const version = report.report_version;
    const t = window.setInterval(() => load(version), POLL_MS);
    return () => window.clearInterval(t);
  }, [report?.status, report?.report_version]);

  const regenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      setReport(await generateReport(interviewId));
      setMissing(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to start report generation.'));
    } finally {
      setGenerating(false);
    }
  };

  const download = async () => {
    if (!report) return;
    setDownloading(true);
    setError('');
    try {
      await downloadReportPdf(interviewId, report.report_version, report.candidate_info?.candidate_name || 'candidate');
    } catch (err) {
      setError(getErrorMessage(err, 'The PDF could not be downloaded. Please try again.'));
    } finally {
      setDownloading(false);
    }
  };

  const header = (
    <nav className="navbar no-print">
      <Link to="/dashboard" className="nav-brand">CandidateLens</Link>
      <div className="button-row">
        {report && (report.status === 'ready' || report.status === 'partial') && (
          <button className="btn-primary-sm" onClick={download} disabled={downloading}>
            {downloading ? <Loader2 size={16} className="spin" /> : <Download size={16} />} {downloading ? 'Preparing PDF…' : 'Download PDF'}
          </button>
        )}
      </div>
    </nav>
  );

  if (missing) {
    return (
      <div className="dashboard-layout">{header}
        <main className="dashboard-content">
          <Link to="/dashboard" className="back-link"><ArrowLeft size={16} /> Back</Link>
          <div className="card">
            <h1 className="card-title">No report yet</h1>
            <p className="hint">Reports are generated automatically when the AI interview finishes. You can also generate one now if the AI interview is complete.</p>
            <button className="btn-primary-sm" onClick={regenerate} disabled={generating}>Generate report</button>
            {error && <div className="error-message" role="alert">{error}</div>}
          </div>
        </main>
      </div>
    );
  }

  if (!report) {
    return <div className="dashboard-layout">{header}<main className="dashboard-content"><div className="empty-state">{error || 'Loading report…'}</div></main></div>;
  }

  const info = report.candidate_info || {};
  const summary = report.executive_summary;

  return (
    <div className="dashboard-layout">
      {header}
      <main className="dashboard-content report">
        <Link to={info.candidate_id ? `/candidates/${info.candidate_id}` : '/dashboard'} className="back-link no-print">
          <ArrowLeft size={16} /> Back to candidate
        </Link>

        <div className="report-title-row">
          <div>
            <h1 className="profile-name">Assessment report — {info.candidate_name || 'Candidate'}</h1>
            <div className="hint">
              Version {report.report_version}{report.generated_at ? ` · generated ${formatDateTime(report.generated_at)}` : ''} · rubric {report.rubric_version}
              {report.model_name ? ` · ${report.model_name}` : ''}
            </div>
          </div>
          <div className="button-row no-print">
            {report.available_versions && report.available_versions.length > 1 && (
              <select className="filter-input" value={report.report_version} onChange={(e) => load(Number(e.target.value))} aria-label="Report version">
                {report.available_versions.map((v) => <option key={v} value={v}>Version {v}</option>)}
              </select>
            )}
            <button className="btn-secondary-sm" onClick={regenerate} disabled={generating || report.status === 'generating'}>
              <RefreshCw size={16} /> Regenerate
            </button>
          </div>
        </div>

        <div className="notice notice-info" style={{ cursor: 'default', margin: '1rem 0' }}>
          <AlertTriangle size={16} /> AI-assisted report for human review. It does not make a hiring decision; the decision belongs to HR.
        </div>
        {error && <div className="flash-error" role="alert"><span>{error}</span></div>}

        {report.status === 'generating' && (
          <div className="card"><Loader2 size={18} className="spin" /> Generating the report from saved answers and evaluations…</div>
        )}
        {report.status === 'failed' && <div className="flash-error"><span>Report generation failed: {report.error}</span></div>}
        {report.status === 'partial' && (
          <div className="notice notice-warn">The narrative sections could not be generated ({report.error}). Scores and evidence below come directly from saved data. Try Regenerate.</div>
        )}

        {report.status !== 'generating' && report.status !== 'failed' && (
          <>
            <section className="card report-section">
              <h2 className="card-title">A. Candidate and interview</h2>
              <dl className="detail-list">
                <div><dt>Candidate</dt><dd>{info.candidate_name} <span className="hint">({info.candidate_id})</span></dd></div>
                <div><dt>Target role</dt><dd>{info.target_role} · {info.difficulty}</dd></div>
                <div><dt>Interview</dt><dd>{info.interview_id}</dd></div>
                <div><dt>Date</dt><dd>{formatDateTime(info.interview_date)}</dd></div>
                <div><dt>Duration</dt><dd>
                  {info.actual_duration_minutes != null ? `${info.actual_duration_minutes} min interview` : 'Interview still in progress'}
                  {info.ai_duration_minutes != null ? ` · ${info.ai_duration_minutes} min AI-assisted portion` : ''} (scheduled {info.scheduled_duration_minutes} min)
                </dd></div>
                <div><dt>Completion</dt><dd>
                  {info.questions_answered} of {info.questions_planned} planned questions answered
                  {info.follow_ups_answered ? ` (+${info.follow_ups_answered} follow-ups)` : ''} · {String(info.completion_reason || info.ai_interview_status).replace(/_/g, ' ')}
                </dd></div>
                <div><dt>Resume</dt><dd>{info.resume_reference ? `${info.resume_reference.filename} (ref ${info.resume_reference.fingerprint})` : 'No resume analysis'}</dd></div>
                <div><dt>Rubric</dt><dd>{info.rubric_version}</dd></div>
              </dl>
            </section>

            <section className="card report-section">
              <h2 className="card-title">B. Executive summary</h2>
              {summary ? (
                <>
                  <p>{summary.text}</p>
                  {summary.topics_covered.length > 0 && <div className="chip-row" style={{ marginTop: 8 }}>{summary.topics_covered.map((t) => <span key={t} className="chip">{t}</span>)}</div>}
                  {summary.skills_demonstrated.length > 0 && (
                    <><h3 className="subsection-title">Skills demonstrated</h3>
                      <ul className="plain-list">{summary.skills_demonstrated.map((s) => <li key={s.text}>{s.text} <Refs refs={s.question_refs} /></li>)}</ul></>
                  )}
                  {summary.technical_observations.length > 0 && (
                    <><h3 className="subsection-title">Technical observations</h3>
                      <ul className="plain-list">{summary.technical_observations.map((s) => <li key={s.text}>{s.text} <Refs refs={s.question_refs} /></li>)}</ul></>
                  )}
                  {summary.limited_evidence_areas.length > 0 && (
                    <><h3 className="subsection-title">Areas with limited evidence</h3><ul className="plain-list">{summary.limited_evidence_areas.map((s) => <li key={s}>{s}</li>)}</ul></>
                  )}
                  {summary.items_requiring_follow_up.length > 0 && (
                    <><h3 className="subsection-title">Items requiring follow-up</h3><ul className="plain-list">{summary.items_requiring_follow_up.map((s) => <li key={s}>{s}</li>)}</ul></>
                  )}
                </>
              ) : <div className="hint">Not available.</div>}
            </section>

            <section className="card report-section">
              <h2 className="card-title">C. Score analysis</h2>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Dimension</th><th>Score</th><th>Answers scored</th><th>Evidence status</th><th>Review</th></tr></thead>
                  <tbody>
                    {report.dimension_scores.map((d) => (
                      <tr key={d.dimension}>
                        <td>{d.label}</td>
                        <td>{d.average !== null ? `${d.average.toFixed(1)}/5` : '—'}</td>
                        <td>{d.evaluated_answers}{d.needs_review ? ` (+${d.needs_review} need review)` : ''}</td>
                        <td>{d.evidence_status === 'not_enough_evidence' ? 'Not enough evidence' : d.evidence_status === 'limited_evidence' ? 'Limited evidence' : 'Sufficient evidence'}</td>
                        <td>{d.review_status === 'needs_review' ? 'Needs review' : 'OK'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.aggregate && (
                <div className="aggregate">
                  <div><strong>Aggregate: {report.aggregate.value !== null ? `${report.aggregate.value.toFixed(2)} / 5` : 'not calculable'}</strong></div>
                  <div className="hint">{report.aggregate.formula}</div>
                  <div className="hint">Contributing: {report.aggregate.contributing.map((c) => `${c.label} ${c.average.toFixed(1)} × ${c.weight}`).join(' · ') || 'none'}</div>
                  {report.aggregate.excluded.length > 0 && <div className="hint">Excluded: {report.aggregate.excluded.map((e) => `${e.label} (${e.reason})`).join(' · ')}</div>}
                </div>
              )}
              <details className="no-print" style={{ marginTop: 12 }}>
                <summary className="hint">Latest supporting evidence per dimension</summary>
                <ProvisionalScores dimensions={report.dimension_scores} provisional={false} />
              </details>
            </section>

            {report.claim_verification && (
              <section className="card report-section">
                <h2 className="card-title">Resume claim verification</h2>
                <p className="hint">{report.claim_verification.note}</p>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th>Claim (candidate-provided)</th><th>Source</th><th>Interview evidence</th></tr></thead>
                    <tbody>
                      {report.claim_verification.items.map((c) => (
                        <tr key={c.claim_id}>
                          <td style={{ whiteSpace: 'normal' }}><span className="claim-id">{c.claim_id}</span> {c.claim}
                            {c.resume_needs_clarification && <div className="hint">Resume statement needs clarification</div>}
                          </td>
                          <td style={{ whiteSpace: 'normal' }}>{c.source_verified ? `“${c.source_text}”` : <span className="text-warn">Quote not found in resume</span>}{c.section ? ` — ${c.section}` : ''}</td>
                          <td style={{ whiteSpace: 'normal' }}>{CLAIM_STATUS[c.interview_status] || c.interview_status} <Refs refs={c.question_refs} />
                            {c.note && <div className="hint">{c.note}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="card report-section">
              <h2 className="card-title">D. Question-by-question analysis</h2>
              {report.question_analysis.map((q) => (
                <QuestionAnalysis key={q.question_id} q={q} interviewId={interviewId} />
              ))}
            </section>

            <section className="card report-section">
              <h2 className="card-title">E. Strengths</h2>
              {report.strengths.length ? (
                <ul className="plain-list">{report.strengths.map((s) => (
                  <li key={s.strength}>{s.strength} <Refs refs={s.question_refs} /><div className="evidence-quote">“{s.evidence_excerpt}”</div></li>
                ))}</ul>
              ) : <div className="hint">No evidence-backed strengths were identified.</div>}
            </section>

            <section className="card report-section">
              <h2 className="card-title">F. Areas for further assessment</h2>
              {report.areas_for_follow_up.length ? (
                <ul className="plain-list">{report.areas_for_follow_up.map((a, idx) => (
                  <li key={`${a.area}-${idx}`}><strong>{a.area}</strong> — {a.reason} <Refs refs={a.question_refs} /></li>
                ))}</ul>
              ) : <div className="hint">None identified.</div>}
            </section>

            <section className="card report-section">
              <h2 className="card-title">G. Suggested HR follow-up questions</h2>
              <p className="hint">Suggestions only — not mandatory interview requirements.</p>
              {report.suggested_questions.length ? (
                <ol className="plain-list">{report.suggested_questions.map((q) => <li key={q.question}>{q.question}<div className="hint">{q.rationale}</div></li>)}</ol>
              ) : <div className="hint">None.</div>}
            </section>

            <section className="card report-section">
              <h2 className="card-title">H. Evidence and limitations</h2>
              <ul className="plain-list">{report.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
            </section>
          </>
        )}

        <HRReviewSection report={report} onSaved={setReport} />
      </main>
    </div>
  );
};

const QuestionAnalysis: React.FC<{ q: ReportQuestion; interviewId: string }> = ({ q, interviewId }) => {
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [score, setScore] = useState(3);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');

  const submit = async (dimension: string, action: 'override' | 'mark_needs_review') => {
    if (!q.answer_id || note.trim().length < 3) {
      setMessage('Add a short note explaining the correction.');
      return;
    }
    try {
      await reviewEvaluation(interviewId, q.answer_id, { dimension, action, score: action === 'override' ? score : undefined, note });
      setMessage('Saved as a new evaluation version. Regenerate the report to include it.');
      setReviewing(null);
      setNote('');
    } catch (err) {
      setMessage(getErrorMessage(err, 'Failed to save the correction.'));
    }
  };

  return (
    <article id={`q-${q.label}`} className={`qa-card ${q.is_follow_up ? 'qa-follow-up' : ''}`}>
      <div className="question-progress">
        {q.label} · {q.category_label}{q.is_follow_up ? ' · Follow-up' : ''}
        {q.review_flags.map((f) => <span key={f} className="status-badge status-awaiting" style={{ marginLeft: 6 }}>{f.replace(/_/g, ' ')}</span>)}
      </div>
      <p className="question-text">{q.text}</p>
      {!q.asked ? <div className="hint">Not asked.</div> : q.status === 'skipped' ? (
        <div className="hint">Skipped: {q.skip_reason}</div>
      ) : q.transcript ? (
        <>
          <div className="room-section-title">Candidate answer ({q.capture_method}{q.transcript_edited ? ', transcript corrected by candidate' : ''})</div>
          <blockquote className="transcript-quote">{q.transcript}</blockquote>
          {q.verbatim_transcript && <details><summary className="hint">Original speech-to-text</summary><blockquote className="transcript-quote">{q.verbatim_transcript}</blockquote></details>}
          {q.transcript_flag_note && <div className="hint text-warn">Transcript flagged: {q.transcript_flag_note}</div>}
        </>
      ) : <div className="hint">No answer submitted.</div>}

      {q.evaluations.length > 0 && (
        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table className="data-table">
            <thead><tr><th>Dimension</th><th>Score</th><th>Rationale and evidence</th><th className="no-print"></th></tr></thead>
            <tbody>
              {q.evaluations.map((e) => (
                <tr key={e.id}>
                  <td>{e.dimension_label}{e.source === 'hr' && <div className="hint">HR-reviewed</div>}</td>
                  <td>{e.score !== null ? `${e.score}/5` : EVIDENCE_STATUS[e.evidence_status]}</td>
                  <td style={{ whiteSpace: 'normal' }}>{e.rationale}
                    {e.evidence_excerpt && <div className="evidence-quote">“{e.evidence_excerpt}”{e.excerpt_verified === false ? ' (not matched to answer)' : ''}</div>}
                  </td>
                  <td className="no-print">
                    {reviewing === e.dimension ? (
                      <div className="review-inline">
                        <select className="filter-input" value={score} onChange={(ev) => setScore(Number(ev.target.value))} aria-label="Corrected score">
                          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <input className="filter-input" placeholder="Reason" value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={1000} />
                        <button className="btn-primary-sm" onClick={() => submit(e.dimension, 'override')}>Save score</button>
                        <button className="btn-secondary-sm" onClick={() => submit(e.dimension, 'mark_needs_review')}>Mark for review</button>
                        <button className="link-button" onClick={() => setReviewing(null)}>Cancel</button>
                      </div>
                    ) : q.answer_id ? (
                      <button className="link-button" style={{ marginTop: 0 }} onClick={() => { setReviewing(e.dimension); setMessage(''); }}>Correct</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.missing_evidence.length > 0 && <div className="hint">Missing evidence: {q.missing_evidence.join('; ')}</div>}
      {q.follow_up && <div className="hint">Follow-up asked ({q.follow_up.label}): {q.follow_up.text}</div>}
      {message && <div className="hint" role="status">{message}</div>}
    </article>
  );
};

const HRReviewSection: React.FC<{ report: AssessmentReport; onSaved: (r: AssessmentReport) => void }> = ({ report, onSaved }) => {
  const review = report.hr_review;
  const [form, setForm] = useState({
    hr_notes: review.notes || '', hr_clarifications: review.clarifications || '',
    hr_next_step: review.next_step || '', hr_decision: review.decision || '',
  });
  const [status, setStatus] = useState('');
  const [isPending, startTransition] = useTransition();
  const [shownReview, setOptimisticReview] = useOptimistic(review, (_, next: typeof review) => next);

  useEffect(() => {
    setForm({ hr_notes: review.notes || '', hr_clarifications: review.clarifications || '',
              hr_next_step: review.next_step || '', hr_decision: review.decision || '' });
  }, [report.id]);

  const save = () => {
    setStatus('');
    startTransition(async () => {
      setOptimisticReview({ ...review, notes: form.hr_notes, clarifications: form.hr_clarifications,
                            next_step: form.hr_next_step || null, decision: form.hr_decision, reviewed_at: new Date().toISOString() });
      try {
        const saved = await reviewReport(report.id, { ...form, hr_next_step: form.hr_next_step || null, version: report.version });
        startTransition(() => onSaved({ ...saved, available_versions: report.available_versions }));
        setStatus('Review saved.');
      } catch (err) {
        setStatus(isConflict(err) ? 'This report changed elsewhere. Reload before saving.' : getErrorMessage(err, 'Failed to save the review.'));
      }
    });
  };

  return (
    <section className="card report-section hr-review">
      <h2 className="card-title">I. HR review</h2>
      <p className="hint">Your independent review. Stored separately from all AI-generated findings above.</p>
      <div className="hint" style={{ marginBottom: 8 }}>
        {shownReview.reviewed_at ? `Last reviewed by ${shownReview.reviewer_name || 'you'} on ${formatDateTime(shownReview.reviewed_at)}` : 'Not reviewed yet'}
      </div>
      <label className="form-label">Notes
        <textarea className="form-input" rows={4} maxLength={10000} value={form.hr_notes} onChange={(e) => setForm({ ...form, hr_notes: e.target.value })} />
      </label>
      <label className="form-label">Areas for clarification
        <textarea className="form-input" rows={3} maxLength={5000} value={form.hr_clarifications} onChange={(e) => setForm({ ...form, hr_clarifications: e.target.value })} />
      </label>
      <label className="form-label">Suggested next step
        <select className="form-input" value={form.hr_next_step} onChange={(e) => setForm({ ...form, hr_next_step: e.target.value })}>
          <option value="">Select…</option>
          {Object.entries(NEXT_STEPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="form-label">Independent decision
        <textarea className="form-input" rows={3} maxLength={5000} value={form.hr_decision} onChange={(e) => setForm({ ...form, hr_decision: e.target.value })} />
      </label>
      <div className="button-row no-print">
        <button className="btn-primary-sm" onClick={save} disabled={isPending}>{isPending ? 'Saving…' : 'Save review'}</button>
        {status && <span className="hint" role="status">{status}</span>}
      </div>
    </section>
  );
};

export default InterviewReportPage;
