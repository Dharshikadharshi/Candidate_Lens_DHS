import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import InterviewReportPage from '../pages/InterviewReportPage';
import type { AssessmentReport } from '../types/ai';

const reviewReport = vi.fn();
const downloadReportPdf = vi.fn();
const report: AssessmentReport = {
  id: 'r-1', interview_id: 'i-1', report_version: 1, status: 'ready', error: null,
  candidate_info: { candidate_name: 'Priya Sharma', candidate_id: 'c-1', target_role: 'Backend Developer', interview_id: 'i-1',
                    interview_date: '2026-09-27T10:00:00Z', scheduled_duration_minutes: 30, actual_duration_minutes: 24,
                    questions_answered: 2, questions_planned: 2, completion_reason: 'all_questions_handled',
                    difficulty: 'junior', resume_reference: null, rubric_version: 'cl-rubric-2026.1' },
  executive_summary: { text: 'The candidate discussed FastAPI and transactions.', topics_covered: ['FastAPI'],
                       skills_demonstrated: [], limited_evidence_areas: [], technical_observations: [], items_requiring_follow_up: [] },
  dimension_scores: [{ dimension: 'technical_knowledge', label: 'Technical knowledge', average: 4, evaluated_answers: 2,
                       awaiting_evaluation: 0, needs_review: 0, insufficient_data: 0, evaluation_failed: 0,
                       evidence_status: 'sufficient_evidence', review_status: 'ok', latest_evidence: null }],
  aggregate: { value: 4, scale: '1-5', formula: 'Weighted mean of dimension averages.', weights: { technical_knowledge: 1 },
               contributing: [{ dimension: 'technical_knowledge', label: 'Technical knowledge', average: 4, weight: 1, answers: 2 }], excluded: [] },
  question_analysis: [{
    label: 'Q1', question_id: 'q-1', category_label: 'Technical knowledge', text: 'What is a transaction?', is_follow_up: false,
    status: 'evaluated', asked: true, skip_reason: null, source_claim: null, answer_id: 'a-1', capture_method: 'typed',
    transcript: 'A unit of work that commits or rolls back atomically.', verbatim_transcript: null, transcript_edited: false,
    transcript_flag_note: null, evaluation_status: 'completed', missing_evidence: [], follow_up: null, next_action: null, review_flags: [],
    evaluations: [{ id: 'e-1', dimension: 'technical_knowledge', dimension_label: 'Technical knowledge', evidence_status: 'scored',
                    score: 4, rationale: 'Correct definition.', evidence_excerpt: 'commits or rolls back atomically',
                    excerpt_verified: true, confidence: 'high', review_status: 'not_required', source: 'ai',
                    rubric_version: 'cl-rubric-2026.1', evaluation_version: 1 }],
  }],
  strengths: [{ strength: 'Explains transactions clearly', question_refs: ['Q1'], evidence_excerpt: 'commits or rolls back atomically' }],
  areas_for_follow_up: [], suggested_questions: [{ question: 'How would you choose an isolation level?', rationale: 'Depth' }],
  claim_verification: { note: 'Claims are candidate-provided.', items: [] },
  limitations: ['This report is AI-assisted.'], rubric_version: 'cl-rubric-2026.1', model_name: 'gpt-test', generated_at: '2026-09-27T10:30:00Z',
  hr_review: { reviewer_name: null, reviewed_at: null, notes: null, clarifications: null, next_step: null, decision: null },
  version: 1, available_versions: [1],
};

vi.mock('../services/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/ai')>()),
  getReport: vi.fn(() => Promise.resolve(report)),
  reviewReport: (...args: unknown[]) => reviewReport(...args),
  downloadReportPdf: (...args: unknown[]) => downloadReportPdf(...args),
  reviewEvaluation: vi.fn(),
  generateReport: vi.fn(),
}));

afterEach(cleanup);

const renderPage = () => render(
  <MemoryRouter initialEntries={['/interviews/i-1/report']}>
    <Routes><Route path="/interviews/:interviewId/report" element={<InterviewReportPage />} /></Routes>
  </MemoryRouter>,
);

describe('InterviewReportPage', () => {
  it('renders the evidence-backed report sections', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Assessment report — Priya Sharma/)).toBeTruthy());
    expect(screen.getByText(/does not make a hiring decision/)).toBeTruthy();
    expect(screen.getByText('4.0/5')).toBeTruthy();
    expect(screen.getByText(/Aggregate: 4.00 \/ 5/)).toBeTruthy();
    expect(screen.getByText('What is a transaction?')).toBeTruthy();
    expect(screen.getByText('Explains transactions clearly')).toBeTruthy();
    expect(screen.getByText(/Suggestions only/)).toBeTruthy();
    expect(screen.getByText('I. HR review')).toBeTruthy();
  });

  it('saves the HR review separately with the report version', async () => {
    reviewReport.mockResolvedValue({ ...report, version: 2, hr_review: { ...report.hr_review, notes: 'Strong basics', reviewer_name: 'HR', reviewed_at: '2026-09-27T11:00:00Z' } });
    renderPage();
    await waitFor(() => screen.getByText('I. HR review'));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Strong basics' } });
    fireEvent.change(screen.getByLabelText('Suggested next step'), { target: { value: 'proceed_to_round_1' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save review' })); });
    await waitFor(() => expect(reviewReport).toHaveBeenCalledTimes(1));
    const [reportId, payload] = reviewReport.mock.calls[0];
    expect(reportId).toBe('r-1');
    expect(payload).toMatchObject({ hr_notes: 'Strong basics', hr_next_step: 'proceed_to_round_1', version: 1 });
    await waitFor(() => expect(screen.getByText('Review saved.')).toBeTruthy());
  });

  it('downloads the report as a PDF and shows no AI usage details', async () => {
    downloadReportPdf.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Download PDF/ }));
    expect(screen.queryByText(/AI usage/i)).toBeNull();
    expect(screen.queryByText(/tokens/i)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Download PDF/ })); });
    expect(downloadReportPdf).toHaveBeenCalledWith('i-1', 1, 'Priya Sharma');
  });
});
