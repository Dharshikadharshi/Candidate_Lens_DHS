import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResumeValidationPage from '../pages/ResumeValidationPage';
import type { ValidationReport } from '../types/validation';

const mockReport: ValidationReport = {
  id: 'val-report-1',
  candidate_id: 'cand-1',
  resume_id: 'res-1',
  resume_filename: 'alex_mercer_resume.pdf',
  target_role: 'Senior Full Stack Engineer',
  experience_level: 'senior',
  status: 'completed',
  overall_score: 91.5,
  rubric_version: 'rv-1.0',
  model_name: 'gpt-4o',
  prompt_version: 'resume-validation-v1',
  version: 1,
  created_at: '2026-09-28T10:00:00Z',
  updated_at: '2026-09-28T10:05:00Z',
  has_resume: true,
  summary: 'Strong senior profile with robust full-stack project evidence and clean structure.',
  error: null,
  category_scores: {
    completeness: {
      score: 19.0,
      max_score: 20.0,
      summary: 'All core sections are well documented with comprehensive details.',
    },
    role_relevance: {
      score: 23.5,
      max_score: 25.0,
      summary: 'High relevance to Full Stack engineering roles.',
    },
    skill_evidence: {
      score: 21.0,
      max_score: 25.0,
      summary: 'Listed skills are backed by concrete project outcomes.',
    },
    consistency: {
      score: 14.0,
      max_score: 15.0,
      summary: 'Chronology and dates are consistent throughout.',
    },
    readability: {
      score: 14.0,
      max_score: 15.0,
      summary: 'Clean structure with consistent typography and bullet formatting.',
    },
  },
  detailed_findings: [
    {
      category: 'completeness',
      score: 19.0,
      max_score: 20.0,
      finding_description: 'Education, experience, and project sections present.',
      relevant_excerpt: 'B.S. in Computer Science',
      section_or_page: 'Education, Page 1',
      reasoning: 'Standard academic qualifications provided.',
      recommended_action: 'None required.',
      review_status: 'verified',
      source_verified: true,
    },
    {
      category: 'role_relevance',
      score: 23.5,
      max_score: 25.0,
      finding_description: 'Direct experience with React and Python.',
      relevant_excerpt: 'Architected distributed web services using Python and React.',
      section_or_page: 'Experience',
      reasoning: 'Directly maps to the job description.',
      recommended_action: 'Explore architecture choices in technical round.',
      review_status: 'verified',
      source_verified: true,
    },
  ],
  skills_evidence_map: [
    {
      skill: 'React',
      status: 'supported',
      evidence_excerpt: 'Architected distributed web services using Python and React.',
      section_or_page: 'Experience',
      notes: 'Demonstrated in production environment.',
      source_verified: true,
    },
    {
      skill: 'GraphQL',
      status: 'not_mentioned',
      evidence_excerpt: null,
      section_or_page: null,
      notes: 'Not found in resume text.',
      source_verified: false,
    },
  ],
  suggested_questions: [
    'Can you describe the distributed caching strategy you implemented?',
    'How do you manage state transitions in complex React forms?',
  ],
};

const mockCandidate = {
  id: 'cand-1',
  full_name: 'Alex Mercer',
  email: 'alex.mercer@example.com',
  phone: '+1 555-0123',
  target_role: 'Senior Full Stack Engineer',
  status: 'active',
  created_at: '2026-09-28T09:00:00Z',
  updated_at: '2026-09-28T09:00:00Z',
  resume: {
    id: 'res-1',
    original_filename: 'alex_mercer_resume.pdf',
    file_type: 'application/pdf',
    file_size: 102400,
    uploaded_at: '2026-09-28T09:05:00Z',
  },
  interviews: [],
};

const mockDownloadPdf = vi.fn();
const mockRegenerate = vi.fn(() => Promise.resolve({ ...mockReport, version: 2 }));

vi.mock('../services/validation', () => ({
  getValidationReport: vi.fn(() => Promise.resolve(mockReport)),
  getCandidateValidationHistory: vi.fn(() =>
    Promise.resolve({
      candidate_id: 'cand-1',
      candidate_name: 'Alex Mercer',
      has_resume: true,
      latest: mockReport,
      history: [
        {
          id: 'val-report-1',
          target_role: 'Senior Full Stack Engineer',
          status: 'completed',
          overall_score: 91.5,
          version: 1,
          created_at: '2026-09-28T10:00:00Z',
          resume_filename: 'alex_mercer_resume.pdf',
        },
      ],
    }),
  ),
  startResumeValidation: vi.fn(() => Promise.resolve(mockReport)),
  regenerateValidationReport: (...args: any[]) => (mockRegenerate as any)(...args),
  downloadValidationPdf: (...args: any[]) => (mockDownloadPdf as any)(...args),
}));

vi.mock('../services/interviews', () => ({
  getCandidate: vi.fn(() => Promise.resolve(mockCandidate)),
  getErrorMessage: vi.fn((err: any) => err?.message || 'Error occurred'),
}));

afterEach(cleanup);

const renderComponent = () =>
  render(
    <MemoryRouter initialEntries={['/candidates/cand-1/resume-validation']}>
      <Routes>
        <Route
          path="/candidates/:candidateId/resume-validation"
          element={<ResumeValidationPage user={{ id: 'hr-1', name: 'HR Lead' }} onLogout={vi.fn()} />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe('ResumeValidationPage', () => {
  it('renders candidate header, overall score, and category cards', async () => {
    renderComponent();

    // Candidate info
    await waitFor(() => {
      expect(screen.getByText('Alex Mercer')).toBeTruthy();
    });
    expect(screen.getByText(/alex_mercer_resume\.pdf/)).toBeTruthy();

    // Overall score (91.5 rounded to 92)
    expect(screen.getByText('92')).toBeTruthy();
    expect(screen.getByText('Validated')).toBeTruthy();

    // 5 Categories present
    expect(screen.getAllByText('Resume Completeness').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Target-Role Relevance').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Evidence Supporting Skills').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Internal Consistency').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Readability & Structure').length).toBeGreaterThanOrEqual(1);
  });

  it('renders detailed findings and verbatim excerpts', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Education, experience, and project sections present.')).toBeTruthy();
    });
    expect(screen.getByText(/B\.S\. in Computer Science/)).toBeTruthy();
    expect(screen.getByText('Direct experience with React and Python.')).toBeTruthy();
  });

  it('renders skills evidence map and suggested follow-up questions', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('React')).toBeTruthy();
    });
    expect(screen.getByText('GraphQL')).toBeTruthy();
    expect(
      screen.getByText('Can you describe the distributed caching strategy you implemented?'),
    ).toBeTruthy();
    expect(
      screen.getByText('How do you manage state transitions in complex React forms?'),
    ).toBeTruthy();
  });

  it('displays assessment limitations disclaimer', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Assessment Limitations & Document Scope/i)).toBeTruthy();
    });
    expect(screen.getByText(/does not verify candidate identity, honesty, or eventual job performance/i)).toBeTruthy();
  });

  it('triggers PDF download when Download PDF button is clicked', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Download PDF')).toBeTruthy();
    });

    const downloadBtn = screen.getByText('Download PDF');
    fireEvent.click(downloadBtn);

    expect(mockDownloadPdf).toHaveBeenCalledWith('val-report-1', 'Resume_Validation_Alex_Mercer_v1.pdf');
  });
});
