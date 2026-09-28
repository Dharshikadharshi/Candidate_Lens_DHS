import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { createAIPlan, getAIPlan } from '../../services/ai';
import { getErrorMessage } from '../../services/interviews';
import { DEFAULT_PLAN_CONFIG, type AIPlan, type AIPlanConfig, type QuestionCounts } from '../../types/ai';

const CATEGORY_FIELDS: { key: keyof QuestionCounts; label: string; toggle: keyof AIPlanConfig }[] = [
  { key: 'resume_technical', label: 'Resume-based technical', toggle: 'enable_resume_questions' },
  { key: 'project_defense', label: 'Project defense', toggle: 'enable_project_defense' },
  { key: 'technical_knowledge', label: 'Technical knowledge', toggle: 'enable_technical_questions' },
  { key: 'scenario', label: 'Scenario-based', toggle: 'enable_scenarios' },
];

interface AIPlanSetupProps {
  interviewId: string;
  targetRole: string;
  durationMinutes: number;
  roles?: { key: string; label: string }[];
  onPlanChange?: (plan: AIPlan | null) => void;
  compact?: boolean;
}

const POLL_MS = 2000;

const AIPlanSetup: React.FC<AIPlanSetupProps> = ({ interviewId, targetRole, durationMinutes, roles, onPlanChange, compact }) => {
  const [plan, setPlan] = useState<AIPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<AIPlanConfig>({ ...DEFAULT_PLAN_CONFIG, target_role: targetRole });
  const [showConfig, setShowConfig] = useState(!compact);
  const [showQuestions, setShowQuestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const data = await getAIPlan(interviewId);
    const next = data.status === 'not_configured' ? null : (data as AIPlan);
    setPlan(next);
    onPlanChange?.(next);
    if (next?.configuration?.requested) setConfig(next.configuration.requested);
    return next;
  };

  useEffect(() => {
    load().catch((err) => setError(getErrorMessage(err, 'Failed to load the AI plan.'))).finally(() => setLoaded(true));
  }, [interviewId]);

  // While the backend generates questions, poll until the plan settles.
  useEffect(() => {
    if (plan?.status !== 'generating') return;
    const t = window.setInterval(() => { load().catch(() => undefined); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [plan?.status]);

  const total = CATEGORY_FIELDS.reduce((sum, f) => sum + (config[f.toggle] ? config.question_counts[f.key] : 0), 0);
  const cap = Math.min(12, Math.max(3, Math.floor(durationMinutes / 3)));

  const setCount = (key: keyof QuestionCounts, value: number) =>
    setConfig((c) => ({ ...c, question_counts: { ...c.question_counts, [key]: Math.max(0, Math.min(5, value || 0)) } }));

  const submit = async (regenerate: boolean) => {
    if (!config.speech_to_text_enabled && !config.typed_answers_allowed) {
      setError('Enable spoken answers, typed answers, or both.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const next = await createAIPlan(interviewId, config, regenerate);
      setPlan(next);
      onPlanChange?.(next);
      setShowConfig(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to start question generation.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!loaded) return <div className="hint">Loading AI interview setup…</div>;

  const locked = plan?.status === 'active' || plan?.status === 'completed';
  const generating = plan?.status === 'generating';

  return (
    <div className="ai-plan-setup">
      {plan && (
        <div className="ai-plan-status">
          {generating && <><Loader2 size={16} className="spin" /> Generating a personalised question plan… (usually under a minute)</>}
          {plan.status === 'ready' && <><Sparkles size={16} color="var(--primary-color)" /> Plan ready: {plan.questions.length} questions · {plan.difficulty} · {plan.role}</>}
          {plan.status === 'failed' && <span className="text-error">Plan generation failed: {plan.error}</span>}
          {plan.status === 'active' && <>AI interview in progress · {plan.questions.filter((q) => !q.is_follow_up).length} planned questions</>}
          {plan.status === 'completed' && <>AI interview completed</>}
        </div>
      )}
      {plan?.configuration?.adjustments && plan.configuration.adjustments.length > 0 && (
        <ul className="plain-list hint" style={{ marginTop: 4 }}>
          {plan.configuration.adjustments.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}

      {!locked && !generating && (
        <>
          {!showConfig ? (
            <div className="button-row" style={{ marginTop: 8 }}>
              {!plan || plan.status === 'failed' ? (
                <>
                  <button className="btn-primary-sm" onClick={() => submit(!!plan)} disabled={submitting}>
                    <Sparkles size={16} /> {plan ? 'Retry generation' : 'Generate question plan'}
                  </button>
                  <button className="btn-secondary-sm" onClick={() => setShowConfig(true)}>Configure</button>
                </>
              ) : (
                <button className="btn-secondary-sm" onClick={() => setShowConfig(true)}><RefreshCw size={16} /> Adjust and regenerate</button>
              )}
            </div>
          ) : (
            <div className="ai-config">
              <div className="ai-config-grid">
                <label className="form-label">Target role
                  <input className="form-input" list="ai-role-options" value={config.target_role || ''} maxLength={120}
                         onChange={(e) => setConfig((c) => ({ ...c, target_role: e.target.value }))} />
                  <datalist id="ai-role-options">{roles?.map((r) => <option key={r.key} value={r.label} />)}</datalist>
                </label>
                <label className="form-label">Difficulty
                  <select className="form-input" value={config.difficulty || ''}
                          onChange={(e) => setConfig((c) => ({ ...c, difficulty: (e.target.value || null) as AIPlanConfig['difficulty'] }))}>
                    <option value="">Auto (from resume)</option>
                    <option value="junior">Junior</option>
                    <option value="mid">Mid-level</option>
                    <option value="senior">Senior</option>
                  </select>
                </label>
              </div>
              <div className="ai-config-counts">
                {CATEGORY_FIELDS.map((f) => (
                  <div key={f.key} className="count-row">
                    <label>
                      <input type="checkbox" checked={!!config[f.toggle]}
                             onChange={(e) => setConfig((c) => ({ ...c, [f.toggle]: e.target.checked }))} /> {f.label}
                    </label>
                    <input type="number" min={0} max={5} className="form-input count-input" aria-label={`${f.label} count`}
                           value={config.question_counts[f.key]} disabled={!config[f.toggle]}
                           onChange={(e) => setCount(f.key, Number(e.target.value))} />
                  </div>
                ))}
                <div className={`hint ${total > cap ? 'text-warn' : ''}`}>
                  {total} questions{total > cap ? ` — will be reduced to ${cap} to fit ${durationMinutes} minutes` : ''}
                </div>
              </div>
              <div className="ai-config-toggles">
                <label><input type="checkbox" checked={config.max_follow_ups_per_question > 0}
                              onChange={(e) => setConfig((c) => ({ ...c, max_follow_ups_per_question: e.target.checked ? 1 : 0 }))} /> Allow one follow-up per question</label>
                <label><input type="checkbox" checked={config.speech_to_text_enabled}
                              onChange={(e) => setConfig((c) => ({ ...c, speech_to_text_enabled: e.target.checked }))} /> Spoken answers (speech-to-text, with candidate consent)</label>
                <label><input type="checkbox" checked={config.typed_answers_allowed}
                              onChange={(e) => setConfig((c) => ({ ...c, typed_answers_allowed: e.target.checked }))} /> Typed answers</label>
              </div>
              <div className="button-row">
                <button className="btn-primary-sm" onClick={() => submit(!!plan)} disabled={submitting || total === 0}>
                  {submitting ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {plan ? 'Regenerate plan' : 'Generate question plan'}
                </button>
                {(plan || compact) && <button className="btn-secondary-sm" onClick={() => setShowConfig(false)}>Cancel</button>}
              </div>
            </div>
          )}
        </>
      )}

      {plan && plan.questions.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button className="link-button" style={{ marginTop: 0 }} onClick={() => setShowQuestions((s) => !s)}>
            {showQuestions ? 'Hide' : 'Preview'} planned questions (HR only)
          </button>
          {showQuestions && (
            <ol className="plan-preview">
              {plan.questions.filter((q) => !q.is_follow_up).map((q) => (
                <li key={q.id}>
                  <div className="plan-q-meta">{q.category_label}{q.topic ? ` · ${q.topic}` : ''}</div>
                  <div>{q.text}</div>
                  {q.source_claim && <div className="hint">From resume: “{q.source_claim.claim}”</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {error && <div className="error-message" role="alert" style={{ textAlign: 'left' }}>{error}</div>}
    </div>
  );
};

export default AIPlanSetup;
