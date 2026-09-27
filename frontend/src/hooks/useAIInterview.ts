import { useCallback, useEffect, useRef, useState } from 'react';
import { getAssessmentProgress, getCurrentQuestion } from '../services/ai';
import type { AssessmentProgress, CurrentAIState } from '../types/ai';

const BUSY_STATES = ['processing', 'answer_submitted', 'evaluation_in_progress'];
const FAST_MS = 1500;
const SLOW_MS = 5000;

/**
 * Polls the server-owned AI interview state. Polls fast only while something is processing,
 * pauses in background tabs, and never overlaps requests. Unchanged responses are served as
 * 304s from the browser cache thanks to the backend's ETags.
 */
export function useAIInterview(interviewId: string, opts: { role: 'hr' | 'candidate'; token?: string | null; enabled: boolean }) {
  const { role, token, enabled } = opts;
  const [state, setState] = useState<CurrentAIState | null>(null);
  const [progress, setProgress] = useState<AssessmentProgress | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const inFlight = useRef(false);
  const lastPlanVersion = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await getCurrentQuestion(interviewId, role === 'candidate' ? token : null);
      setState(next);
      setError('');
      // Scores only change when the plan version changes; skip the extra request otherwise.
      if (role === 'hr' && next.plan_status !== 'not_configured' && next.plan_version !== lastPlanVersion.current) {
        lastPlanVersion.current = next.plan_version;
        setProgress(await getAssessmentProgress(interviewId));
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Lost contact with the server. Retrying…');
    } finally {
      inFlight.current = false;
    }
  }, [interviewId, role, token]);

  const busy = !!state && (
    state.plan_status === 'generating' ||
    (!!state.question && BUSY_STATES.includes(state.question.answer_state))
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') await refresh();
      if (!cancelled) timer.current = window.setTimeout(loop, busy ? FAST_MS : SLOW_MS);
    };
    loop();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, busy, refresh]);

  return { state, setState, progress, error, refresh };
}
