import React, { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { CheckCircle, ClipboardList, Keyboard, Loader2, Mic, VideoOff } from 'lucide-react';
import AnswerRecorder from './AnswerRecorder';
import { idempotencyKeyFor, recordConsent, submitAnswer, transcribeAnswer } from '../../services/ai';
import { getErrorMessage } from '../../services/interviews';
import type { AnswerState, CurrentAIState } from '../../types/ai';

interface CandidateQuestionPanelProps {
  interviewId: string;
  token: string;
  state: CurrentAIState | null;
  onState: (state: CurrentAIState) => void;
  micTrack?: MediaStreamTrack;
  micMuted: boolean;
  cameraOn: boolean;
  inCall: boolean;
  maxAudioSeconds?: number;
}

const STATE_LABEL: Partial<Record<AnswerState, string>> = {
  waiting_for_answer: 'Waiting for your answer',
  processing: 'Processing your answer…',
  transcript_ready: 'Your answer',
  transcription_failed: 'We could not process your answer',
  answer_submitted: 'Answer submitted',
};

const AUTO_SUBMIT_SECONDS = 8;

export const INTERVIEW_RULES = [
  'Keep your camera on and stay clearly visible for the whole interview.',
  'Sit in a quiet, well-lit place. No other people should be in the room.',
  'Mobile phones and other devices must be put away.',
  'Do not use notes, websites, AI tools or help from anyone else.',
  'Answer each question in your own words; take a moment to think if you need to.',
];

const CandidateQuestionPanel: React.FC<CandidateQuestionPanelProps> = ({
  interviewId, token, state, onState, micTrack, micMuted, cameraOn, inCall, maxAudioSeconds = 300,
}) => {
  const question = state?.question ?? null;
  const [mode, setMode] = useState<'voice' | 'typed'>('voice');
  const [text, setText] = useState('');
  const [flagged, setFlagged] = useState(false);
  const [flagNote, setFlagNote] = useState('');
  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [agreeRules, setAgreeRules] = useState(false);
  const [consentTranscription] = useState(true);
  const [savingConsent, setSavingConsent] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [shownState, setOptimisticState] = useOptimistic<AnswerState | undefined, AnswerState>(
    question?.answer_state, (_, next) => next);
  const submitRef = useRef<(method: 'typed' | 'voice') => void>(() => undefined);

  const capture = state?.capture;
  const voiceAvailable = !!capture?.voice;
  const typedAvailable = !!capture?.typed;
  const interviewerPresent = state?.interviewer_present !== false;
  const canAnswer = inCall && cameraOn && interviewerPresent;

  // New question: reset the local draft. The server decides which question is active.
  useEffect(() => {
    setText(question?.answer?.answer_text || '');
    setFlagged(false);
    setFlagNote('');
    setError('');
    setCountdown(null);
    setMode(voiceAvailable ? 'voice' : 'typed');
  }, [question?.id]);

  // Transcript arrived: show it and submit automatically unless the candidate wants to edit it.
  useEffect(() => {
    if (question?.answer_state === 'transcript_ready') {
      setText(question.answer?.answer_text || '');
      setCountdown(AUTO_SUBMIT_SECONDS);
    }
  }, [question?.answer_state, question?.answer?.transcript_text]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      submitRef.current('voice');
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (!voiceAvailable && typedAvailable) setMode('typed');
  }, [voiceAvailable, typedAvailable]);

  if (!state || state.plan_status === 'not_configured' || state.plan_status === 'generating' || state.plan_status === 'failed') {
    return (
      <div className="ai-panel">
        <div className="room-section-title">Interview questions</div>
        <p className="hint">Your interviewer will begin the questions shortly. Please stay on this screen.</p>
      </div>
    );
  }

  if (!state.consent?.ai_disclosure_acknowledged) {
    const saveConsent = async () => {
      if (!agreeRules) {
        setError('Please confirm you will follow the interview guidelines.');
        return;
      }
      setSavingConsent(true);
      setError('');
      try {
        onState(await recordConsent(interviewId, token, !!capture?.voice_enabled && consentTranscription));
      } catch (err) {
        setError(getErrorMessage(err, 'Could not save your choice. Please try again.'));
      } finally {
        setSavingConsent(false);
      }
    };
    return (
      <div className="ai-panel consent-card">
        <div className="room-section-title"><ClipboardList size={14} style={{ verticalAlign: 'middle' }} /> HR screening round</div>
        <p>Welcome! This is your <strong>HR screening interview</strong>. Your interviewer will ask you a series of questions about your experience, projects and role-related skills — one question at a time.</p>
        <div className="room-section-title" style={{ marginTop: 4 }}>Interview guidelines</div>
        <ul className="plain-list">{INTERVIEW_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
       
        <label className="consent-option">
          <input type="checkbox" checked={agreeRules} onChange={(e) => setAgreeRules(e.target.checked)} />
          I will follow the interview guidelines above.
        </label>
        
        {error && <div className="error-message" role="alert">{error}</div>}
        <button className="btn-primary-sm" onClick={saveConsent} disabled={savingConsent}>
          {savingConsent ? <Loader2 size={16} className="spin" /> : <CheckCircle size={16} />} I'm ready
        </button>
      </div>
    );
  }

  if (state.completed) {
    return (
      <div className="ai-panel">
        <div className="flash-success"><span><CheckCircle size={16} style={{ verticalAlign: 'middle' }} /> That's all the questions. Thank you!</span></div>
        <p className="hint">Please stay on the call — your interviewer will wrap up the interview.</p>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="ai-panel">
        <div className="room-section-title">Interview questions</div>
        <p className="hint">Your interviewer will begin the questions shortly. Please stay on this screen.</p>
      </div>
    );
  }

  const answerState = shownState ?? question.answer_state;
  const submitted = answerState === 'answer_submitted';
  const processing = uploading || answerState === 'processing';

  const onRecorded = async (audio: Blob, duration: number) => {
    setUploading(true);
    setError('');
    try {
      onState(await transcribeAnswer(interviewId, question.id, token, audio, duration));
    } catch (err) {
      setError(getErrorMessage(err, 'Your answer could not be uploaded. Please try again or type your answer.'));
    } finally {
      setUploading(false);
    }
  };

  const submit = (captureMethod: 'typed' | 'voice') => {
    const value = text.trim();
    if (value.length < 2) {
      setError('Please answer before submitting.');
      return;
    }
    if (!canAnswer) return;
    setError('');
    setCountdown(null);
    startTransition(async () => {
      setOptimisticState('answer_submitted');
      try {
        const next = await submitAnswer(interviewId, question.id, token, {
          answer_text: value,
          capture_method: captureMethod,
          transcript_flagged: captureMethod === 'voice' && flagged,
          transcript_flag_note: flagged ? flagNote.trim() || undefined : undefined,
          idempotency_key: idempotencyKeyFor(question.id),
        });
        startTransition(() => onState(next));
      } catch (err) {
        setError(getErrorMessage(err, 'Your answer could not be submitted. Please try again.'));
      }
    });
  };
  submitRef.current = submit;

  const blocker = !interviewerPresent
    ? <div className="notice notice-warn" role="status">Your interviewer has been disconnected. Please wait — the interview will continue when they rejoin.</div>
    : !cameraOn && inCall
      ? <div className="notice notice-warn" role="alert"><VideoOff size={16} /> Please turn your camera on to continue answering.</div>
      : !inCall ? <div className="hint">Join the video call to answer.</div> : null;

  return (
    <div className="ai-panel" aria-live="polite">
      <div className="question-progress">
        Question {question.number} of {question.total}{question.is_follow_up ? ' · Follow-up' : ''}
        <span className="question-category">{question.category_label}</span>
      </div>
      <div className="hint">Your interviewer asks:</div>
      <p className="question-text">{question.text}</p>
      {!listening && <div className={`answer-state state-${answerState}`}>{STATE_LABEL[answerState] || 'Answer submitted'}</div>}
      {blocker}

      {submitted ? (
        <div className="hint"><Loader2 size={14} className="spin" /> Thank you — the next question is on its way…</div>
      ) : (
        <>
          {voiceAvailable && typedAvailable && answerState !== 'transcript_ready' && !listening && (
            <div className="mode-toggle" role="tablist" aria-label="Answer method">
              <button role="tab" aria-selected={mode === 'voice'} className={mode === 'voice' ? 'active' : ''} onClick={() => setMode('voice')}>
                <Mic size={14} /> Speak
              </button>
              <button role="tab" aria-selected={mode === 'typed'} className={mode === 'typed' ? 'active' : ''} onClick={() => setMode('typed')}>
                <Keyboard size={14} /> Type
              </button>
            </div>
          )}

          {mode === 'voice' && voiceAvailable && answerState !== 'transcript_ready' && (
            processing ? (
              <div className="ai-plan-status"><Loader2 size={16} className="spin" /> Processing your answer…</div>
            ) : (
              <>
                {answerState === 'transcription_failed' && (
                  <div className="notice notice-error" role="alert">{question.answer?.transcription_error || 'We could not process your answer.'} Please answer again or type it.</div>
                )}
                <AnswerRecorder
                  key={`${question.id}-${answerState}`}
                  micTrack={micTrack} micMuted={micMuted} maxSeconds={maxAudioSeconds} disabled={!canAnswer}
                  autoStart={answerState === 'waiting_for_answer' && canAnswer}
                  onRecorded={onRecorded} onListeningChange={setListening}
                />
              </>
            )
          )}

          {mode === 'voice' && answerState === 'transcript_ready' && (
            <div className="transcript-review">
              <label className="form-label" htmlFor="transcript-text">Your answer (you can correct any mistakes)</label>
              <textarea id="transcript-text" className="form-input answer-input" value={text} maxLength={6000}
                        onFocus={() => setCountdown(null)} onChange={(e) => { setText(e.target.value); setCountdown(null); }} />
              {countdown !== null && (
                <div className="notice notice-info" style={{ cursor: 'default' }}>
                  Submitting in {countdown}s…
                  <button className="link-button" style={{ marginTop: 0 }} onClick={() => setCountdown(null)}>Edit first</button>
                </div>
              )}
              <label className="consent-option">
                <input type="checkbox" checked={flagged} onChange={(e) => { setFlagged(e.target.checked); setCountdown(null); }} />
                Some words were not captured correctly
              </label>
              {flagged && <input className="form-input" placeholder="What was wrong? (optional)" maxLength={500}
                                 value={flagNote} onChange={(e) => setFlagNote(e.target.value)} />}
              <div className="button-row">
                <button className="btn-primary-sm" onClick={() => submit('voice')} disabled={isPending || !canAnswer}>Submit answer</button>
                <AnswerRecorder key={`${question.id}-rerecord`} micTrack={micTrack} micMuted={micMuted} maxSeconds={maxAudioSeconds}
                                disabled={!canAnswer || isPending} onRecorded={(a, d) => { setCountdown(null); onRecorded(a, d); }}
                                onListeningChange={(l) => { if (l) setCountdown(null); setListening(l); }} />
              </div>
            </div>
          )}

          {mode === 'typed' && typedAvailable && (
            <div>
              <label className="form-label" htmlFor="typed-answer">Your answer</label>
              <textarea id="typed-answer" className="form-input answer-input" value={text} maxLength={6000}
                        placeholder="Type your answer here…" onChange={(e) => setText(e.target.value)} />
              <div className="hint" style={{ textAlign: 'right' }}>{text.length} / 6000</div>
              <button className="btn-primary-sm" onClick={() => submit('typed')} disabled={isPending || text.trim().length < 2 || !canAnswer}>
                Submit answer
              </button>
            </div>
          )}
        </>
      )}
      {error && <div className="error-message" role="alert" style={{ textAlign: 'left' }}>{error}</div>}
    </div>
  );
};

export default CandidateQuestionPanel;
