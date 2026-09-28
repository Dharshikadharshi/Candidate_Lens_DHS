import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CandidateQuestionPanel from '../components/ai/CandidateQuestionPanel';
import type { CurrentAIState } from '../types/ai';

const submitAnswer = vi.fn();
const recordConsent = vi.fn();

vi.mock('../services/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/ai')>()),
  submitAnswer: (...args: unknown[]) => submitAnswer(...args),
  recordConsent: (...args: unknown[]) => recordConsent(...args),
  transcribeAnswer: vi.fn(),
}));

const baseState = (overrides: Partial<CurrentAIState> = {}): CurrentAIState => ({
  plan_status: 'active',
  plan_version: 3,
  question: {
    id: 'q-2',
    label: 'Q2',
    number: 2,
    total: 8,
    is_follow_up: false,
    text: 'How did you handle errors when your API interacted with the database?',
    category_label: 'About your projects',
    answer_state: 'waiting_for_answer',
    answer: null,
  },
  answered_count: 1,
  total_main: 8,
  consent: { ai_disclosure_acknowledged: true, transcription_consent: false },
  capture: { voice: false, voice_enabled: true, typed: true },
  completed: false,
  ...overrides,
});

const renderPanel = (state: CurrentAIState, onState = vi.fn(), cameraOn = true) =>
  render(<CandidateQuestionPanel interviewId="i-1" token="tok" state={state} onState={onState} micMuted={false} inCall cameraOn={cameraOn} />);

beforeEach(() => {
  submitAnswer.mockReset();
  recordConsent.mockReset();
  sessionStorage.clear();
});
afterEach(cleanup);

describe('CandidateQuestionPanel', () => {
  it('shows the screening-round guidelines before any question', async () => {
    const state = baseState({ consent: { ai_disclosure_acknowledged: false, transcription_consent: null } });
    recordConsent.mockResolvedValue(baseState());
    renderPanel(state);
    expect(screen.queryByText(/handle errors/)).toBeNull();
    expect(screen.getByText('HR screening round')).toBeTruthy();
    expect(screen.getByText(/Mobile phones and other devices must be put away/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /I'm ready/ }));
    expect(recordConsent).not.toHaveBeenCalled();  // guidelines must be accepted first
    fireEvent.click(screen.getByLabelText(/follow the interview guidelines/));
    fireEvent.click(screen.getByRole('button', { name: /I'm ready/ }));
    await waitFor(() => expect(recordConsent).toHaveBeenCalledWith('i-1', 'tok', true));
  });

  it('blocks answering while the camera is off or the interviewer is away', () => {
    const { unmount } = renderPanel(baseState(), vi.fn(), false);
    expect(screen.getByText(/turn your camera on/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Some answer text' } });
    expect((screen.getByRole('button', { name: 'Submit answer' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    renderPanel(baseState({ interviewer_present: false }));
    expect(screen.getByText(/interviewer has been disconnected/)).toBeTruthy();
  });

  it('shows only the single active question with its progress', () => {
    renderPanel(baseState());
    expect(screen.getByText('Question 2 of 8')).toBeTruthy();
    expect(screen.getByText(/How did you handle errors/)).toBeTruthy();
    expect(screen.getByText('Waiting for your answer')).toBeTruthy();
    // Voice was declined, so only the typed answer box is offered.
    expect(screen.queryByRole('tab', { name: /Speak/ })).toBeNull();
    expect(screen.getByLabelText('Your answer')).toBeTruthy();
  });

  it('submits a typed answer once and reuses the idempotency key when retrying', async () => {
    submitAnswer.mockRejectedValueOnce({ response: { status: 500, data: { detail: 'Network hiccup' } } });
    const onState = vi.fn();
    renderPanel(baseState(), onState);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'I wrapped writes in transactions and rolled back on errors.' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit answer' })); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Network hiccup'));

    submitAnswer.mockResolvedValueOnce(baseState({ question: { ...baseState().question!, answer_state: 'answer_submitted' } }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit answer' })); });
    await waitFor(() => expect(onState).toHaveBeenCalled());

    expect(submitAnswer).toHaveBeenCalledTimes(2);
    const [first, second] = submitAnswer.mock.calls.map((c) => c[3]);
    expect(first.idempotency_key).toBe(second.idempotency_key);
    expect(first.capture_method).toBe('typed');
  });

  it('lets the candidate review and correct a transcript before submitting', () => {
    const state = baseState({
      capture: { voice: true, voice_enabled: true, typed: true },
      question: {
        ...baseState().question!,
        answer_state: 'transcript_ready',
        answer: {
          id: 'a1', status: 'draft', capture_method: 'voice', transcription_status: 'completed', transcription_error: null,
          transcript_text: 'I used fast a p i', answer_text: 'I used fast a p i', transcript_edited: false,
          transcript_flagged: false, submitted_at: null, idempotency_key: null,
        },
      },
    });
    renderPanel(state);
    const box = screen.getByLabelText(/Your answer \(you can correct/) as HTMLTextAreaElement;
    expect(box.value).toBe('I used fast a p i');
    expect(screen.getByText(/Submitting in 8s/)).toBeTruthy();  // hands-free, but can be edited first
    fireEvent.click(screen.getByRole('button', { name: 'Edit first' }));
    expect(screen.queryByText(/Submitting in/)).toBeNull();
    expect(screen.getByLabelText(/not captured correctly/)).toBeTruthy();
  });

  it('shows submitted state without any evaluation details', () => {
    renderPanel(baseState({ question: { ...baseState().question!, answer_state: 'answer_submitted' } }));
    expect(screen.getByText(/next question is on its way/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit answer' })).toBeNull();
    expect(screen.queryByText(/score/i)).toBeNull();
  });

  it('shows a transcription failure with a way forward', () => {
    const state = baseState({
      capture: { voice: true, voice_enabled: true, typed: true },
      question: {
        ...baseState().question!,
        answer_state: 'transcription_failed',
        answer: {
          id: 'a1', status: 'draft', capture_method: 'voice', transcription_status: 'failed',
          transcription_error: 'Could not reach the AI provider.', transcript_text: null, answer_text: null,
          transcript_edited: false, transcript_flagged: false, submitted_at: null, idempotency_key: null,
        },
      },
    });
    renderPanel(state);
    expect(screen.getByText(/Could not reach the AI provider/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Start answering/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Type/ })).toBeTruthy();
  });
});
