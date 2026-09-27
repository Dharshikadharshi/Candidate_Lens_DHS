import React, { useEffect, useState, useTransition } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Loader2, Play, RotateCcw, SkipForward, Square } from 'lucide-react';
import AIPlanSetup from './AIPlanSetup';
import ProvisionalScores from './ProvisionalScores';
import { completeAIInterview, controlQuestions, getAIPlan, retryEvaluation } from '../../services/ai';
import { getErrorMessage } from '../../services/interviews';
import type { AIPlan, AIQuestion, AnswerState, AssessmentProgress, CurrentAIState } from '../../types/ai';

const STATE_LABEL: Record<AnswerState, string> = {
  waiting_for_answer: 'Waiting for answer',
  processing: 'Transcribing…',
  transcript_ready: 'Transcript ready (not submitted)',
  transcription_failed: 'Transcription failed',
  answer_submitted: 'Answer submitted',
  evaluation_in_progress: 'Evaluation in progress…',
  evaluation_completed: 'Evaluation completed',
  evaluation_failed: 'Evaluation failed',
};

interface AIInterviewerPanelProps {
  interviewId: string;
  interviewStatus: string;
  targetRole: string;
  durationMinutes: number;
  state: CurrentAIState | null;
  progress: AssessmentProgress | null;
  onState: (state: CurrentAIState) => void;
  refresh: () => void;
}

const AIInterviewerPanel: React.FC<AIInterviewerPanelProps> = ({
  interviewId, interviewStatus, targetRole, durationMinutes, state, progress, onState, refresh,
}) => {
  const [plan, setPlan] = useState<AIPlan | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [showEvidence, setShowEvidence] = useState(false);

  // The full plan (with handled questions) only needs refetching when the server's plan version changes.
  useEffect(() => {
    if (!state || state.plan_status === 'not_configured') return;
    getAIPlan(interviewId).then((p) => setPlan(p.status === 'not_configured' ? null : (p as AIPlan))).catch(() => undefined);
  }, [interviewId, state?.plan_version]);

  const run = (fn: () => Promise<CurrentAIState | unknown>, fallback: string) => {
    setError('');
    startTransition(async () => {
      try {
        const next = await fn();
        if (next && typeof next === 'object' && 'plan_status' in (next as object)) onState(next as CurrentAIState);
        else refresh();
      } catch (err) {
        setError(getErrorMessage(err, fallback));
        refresh();
      }
    });
  };

  if (!state) return <div className="hint">Loading AI interviewer…</div>;

  const status = state.plan_status;
  if (status === 'not_configured' || status === 'generating' || status === 'failed' || status === 'ready') {
    return (
      <div className="ai-panel">
        <AIPlanSetup interviewId={interviewId} targetRole={targetRole} durationMinutes={durationMinutes} compact
                     onPlanChange={() => refresh()} />
        {status === 'ready' && (
          <div style={{ marginTop: 12 }}>
            <ConsentStatus state={state} />
            <button className="btn-primary-sm" disabled={isPending || interviewStatus !== 'in_progress'}
                    onClick={() => run(() => controlQuestions(interviewId, 'start'), 'Failed to start the AI interview.')}>
              <Play size={16} /> Start AI interview
            </button>
            {interviewStatus !== 'in_progress' && <div className="hint">Start the interview session first.</div>}
          </div>
        )}
        {error && <div className="error-message" role="alert" style={{ textAlign: 'left' }}>{error}</div>}
      </div>
    );
  }

  const q = state.question;
  const handled = (plan?.questions || []).filter(
    (x) => x.id !== q?.id && ['evaluating', 'evaluated', 'evaluation_failed', 'skipped'].includes(x.status || ''));

  return (
    <div className="ai-panel">
      {status === 'completed' ? (
        <div className="flash-success" style={{ marginBottom: 12 }}>
          <span>AI interview completed · {state.answered_count} answers</span>
          <Link to={`/interviews/${interviewId}/report`} className="btn-primary-sm"><FileText size={14} /> Open report</Link>
        </div>
      ) : q ? (
        <CurrentQuestionCard question={q} showEvidence={showEvidence} onToggleEvidence={() => setShowEvidence((s) => !s)} />
      ) : (
        <div className="hint">Selecting the next question…</div>
      )}

      {status === 'active' && (
        <div className="button-row" style={{ margin: '10px 0' }}>
          <button className="btn-secondary-sm" disabled={isPending || !q}
                  onClick={() => {
                    const reason = window.prompt('Reason for skipping this question (recorded in the report):', 'Skipped by interviewer');
                    // Version guard: if the candidate just answered, HR sees the change instead of skipping blindly.
                    if (reason !== null) run(() => controlQuestions(interviewId, 'skip', reason, state.plan_version), 'Failed to skip the question.');
                  }}>
            <SkipForward size={16} /> Skip question
          </button>
          <button className="btn-danger-sm" disabled={isPending}
                  onClick={() => {
                    if (window.confirm('Finish the AI interview now? Unanswered questions will be marked as not asked.')) {
                      run(() => completeAIInterview(interviewId), 'Failed to complete the AI interview.');
                    }
                  }}>
            <Square size={16} /> Finish AI interview
          </button>
        </div>
      )}
      {error && <div className="error-message" role="alert" style={{ textAlign: 'left' }}>{error}</div>}

      {progress && (
        <div className="room-panel-section" style={{ padding: '12px 0' }}>
          <div className="room-section-title">
            {progress.provisional ? 'Provisional assessment' : 'Assessment'} · {progress.questions.answered} answered · {progress.questions.remaining} remaining
          </div>
          <ProvisionalScores dimensions={progress.dimensions} provisional={progress.provisional} compact />
        </div>
      )}

      {handled.length > 0 && (
        <div>
          <div className="room-section-title">Handled questions</div>
          <ul className="handled-list">
            {handled.map((x) => (
              <li key={x.id}>
                <div className="handled-head">
                  <strong>{x.label}</strong> <span className={`answer-state state-${x.answer_state}`}>{x.status === 'skipped' ? 'Skipped' : STATE_LABEL[x.answer_state]}</span>
                  {x.answer_state === 'evaluation_failed' && (
                    <button className="link-button" style={{ marginTop: 0 }} disabled={isPending}
                            onClick={() => run(() => retryEvaluation(interviewId, x.id), 'Retry failed.')}>
                      <RotateCcw size={12} /> Retry evaluation
                    </button>
                  )}
                </div>
                <div className="hint truncate-2">{x.text}</div>
                {x.evaluations && x.evaluations.length > 0 && (
                  <div className="eval-chips">
                    {x.evaluations.map((e) => (
                      <span key={e.id} className={`eval-chip ${e.evidence_status}`} title={e.rationale || ''}>
                        {e.dimension_label.split(' ')[0]}: {e.score ?? (e.evidence_status === 'needs_review' ? 'review' : 'n/a')}
                      </span>
                    ))}
                  </div>
                )}
                {x.next_action?.decision === 'follow_up' && <div className="hint">Follow-up asked: {x.next_action.reason}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const ConsentStatus: React.FC<{ state: CurrentAIState }> = ({ state }) => (
  <div className="hint" style={{ marginBottom: 8 }}>
    Candidate AI notice: {state.consent?.ai_disclosure_acknowledged ? 'acknowledged' : 'not yet acknowledged'} ·
    Transcription: {state.consent?.transcription_consent ? 'consented' : state.consent?.transcription_consent === false ? 'declined (typed answers)' : 'not answered'}
  </div>
);

const CurrentQuestionCard: React.FC<{ question: AIQuestion; showEvidence: boolean; onToggleEvidence: () => void }> = ({
  question, showEvidence, onToggleEvidence,
}) => {
  const a = question.answer;
  const busy = ['processing', 'evaluation_in_progress', 'answer_submitted'].includes(question.answer_state);
  return (
    <div className="current-question">
      <div className="question-progress">
        {question.label} · Question {question.number} of {question.total}{question.is_follow_up ? ' · Follow-up' : ''}
        <span className="question-category">{question.category_label}</span>
      </div>
      <p className="question-text">{question.text}</p>
      <div className={`answer-state state-${question.answer_state}`}>
        {busy && <Loader2 size={12} className="spin" />} {STATE_LABEL[question.answer_state]}
      </div>
      {question.source_claim && (
        <div className="hint">Resume claim: “{question.source_claim.claim}”</div>
      )}
      {question.expected_evidence && question.expected_evidence.length > 0 && (
        <>
          <button className="link-button" style={{ marginTop: 4 }} onClick={onToggleEvidence}>
            {showEvidence ? 'Hide' : 'Show'} what to listen for
          </button>
          {showEvidence && <ul className="plain-list hint">{question.expected_evidence.map((e) => <li key={e}>{e}</li>)}</ul>}
        </>
      )}
      {a && (a.answer_text || a.transcript_text) && (
        <div className="live-transcript">
          <div className="room-section-title">{a.status === 'submitted' ? 'Submitted answer' : 'Draft transcript'} · {a.capture_method}</div>
          <p>{a.answer_text || a.transcript_text}</p>
          {a.transcript_flagged && <div className="text-warn hint">Candidate flagged transcription errors{a.transcript_flag_note ? `: ${a.transcript_flag_note}` : ''}</div>}
        </div>
      )}
      {a?.transcription_error && <div className="text-error hint">{a.transcription_error}</div>}
      {a?.evaluation_error && <div className="text-error hint">{a.evaluation_error}</div>}
    </div>
  );
};

export default AIInterviewerPanel;
