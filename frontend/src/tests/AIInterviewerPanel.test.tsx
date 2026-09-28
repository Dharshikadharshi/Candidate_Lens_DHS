import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AIInterviewerPanel from '../components/ai/AIInterviewerPanel';
import ProvisionalScores from '../components/ai/ProvisionalScores';
import type { AssessmentProgress, CurrentAIState, DimensionProgress } from '../types/ai';

const controlQuestions = vi.fn();

vi.mock('../services/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/ai')>()),
  controlQuestions: (...args: unknown[]) => controlQuestions(...args),
  getAIPlan: vi.fn().mockResolvedValue({ status: 'not_configured' }),
}));

afterEach(cleanup);

const dim = (overrides: Partial<DimensionProgress>): DimensionProgress => ({
  dimension: 'technical_knowledge', label: 'Technical knowledge', average: null, evaluated_answers: 0,
  awaiting_evaluation: 0, needs_review: 0, insufficient_data: 0, evaluation_failed: 0,
  evidence_status: 'not_enough_evidence', review_status: 'ok', latest_evidence: null, ...overrides,
});

const question = (label: string, n: number, text: string) => ({
  id: `q-${n}`, label, number: n, total: 4, is_follow_up: false, text, category_label: 'Technical knowledge',
  answer_state: 'waiting_for_answer' as const, answer: null, expected_evidence: ['ACID', 'rollback'],
  source_claim: null, status: 'active',
});

const state = (q: ReturnType<typeof question>): CurrentAIState => ({
  plan_status: 'active', plan_version: 5, question: q, answered_count: 1, total_main: 4,
  consent: { ai_disclosure_acknowledged: true, transcription_consent: true },
  capture: { voice: true, voice_enabled: true, typed: true }, completed: false,
});

const progress: AssessmentProgress = {
  provisional: true, rubric_version: 'r1', plan_status: 'active',
  dimensions: [dim({ average: 4, evaluated_answers: 1, evidence_status: 'limited_evidence' }),
               dim({ dimension: 'scenario_application', label: 'Scenario-based application' })],
  questions: { planned_main: 4, follow_ups: 0, answered: 1, evaluated: 1, awaiting_evaluation: 0,
               evaluation_failed: 0, skipped: 0, remaining: 3 },
};

describe('ProvisionalScores', () => {
  it('labels scores as provisional and never invents a score without evidence', () => {
    render(<ProvisionalScores dimensions={progress.dimensions} provisional />);
    expect(screen.getByText(/Provisional/)).toBeTruthy();
    expect(screen.getByText('4.0 / 5')).toBeTruthy();
    expect(screen.getByText('Not enough evidence')).toBeTruthy();
  });
});

describe('AIInterviewerPanel', () => {
  it('shows HR the current question with provisional scores', () => {
    render(<MemoryRouter><AIInterviewerPanel interviewId="i-1" interviewStatus="in_progress" targetRole="Backend Developer"
      durationMinutes={30} state={state(question('Q2', 2, 'What is a transaction?'))} progress={progress}
      onState={vi.fn()} refresh={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(/Question 2 of 4/)).toBeTruthy();
    expect(screen.getByText('What is a transaction?')).toBeTruthy();
    expect(screen.getByText(/1 answered · 3 remaining/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /what to listen for/ }));
    expect(screen.getByText('ACID')).toBeTruthy();
  });

  it('displays the next question only after the server confirms it', async () => {
    const next = state(question('Q3', 3, 'A payment API receives duplicate requests. What do you do?'));
    let resolve!: (value: CurrentAIState) => void;
    controlQuestions.mockReturnValue(new Promise<CurrentAIState>((r) => { resolve = r; }));
    vi.spyOn(window, 'prompt').mockReturnValue('Candidate asked to move on');
    const onState = vi.fn();
    render(<MemoryRouter><AIInterviewerPanel interviewId="i-1" interviewStatus="in_progress" targetRole="Backend Developer"
      durationMinutes={30} state={state(question('Q2', 2, 'What is a transaction?'))} progress={progress}
      onState={onState} refresh={vi.fn()} /></MemoryRouter>);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Skip question/ })); });
    expect(controlQuestions).toHaveBeenCalledWith('i-1', 'skip', 'Candidate asked to move on', 5);
    expect(onState).not.toHaveBeenCalled();  // nothing is guessed locally
    await act(async () => { resolve(next); });
    await waitFor(() => expect(onState).toHaveBeenCalledWith(next));
  });
});
