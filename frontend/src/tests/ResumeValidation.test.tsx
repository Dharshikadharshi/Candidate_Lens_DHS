import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CandidateProfilePage from '../pages/CandidateProfilePage';
import ResumeValidationPage from '../pages/ResumeValidationPage';
import ResumeValidationReportPage from '../pages/ResumeValidationReportPage';
import * as validationService from '../services/resumeValidation';
import * as interviewService from '../services/interviews';

// Mock dependencies
vi.mock('../services/resumeValidation');
vi.mock('../services/interviews');

describe('Resume Validation Frontend Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mocks
    vi.mocked(interviewService.getCandidate).mockResolvedValue({
      id: '123',
      full_name: 'Test Candidate',
      target_role: 'Developer',
      status: 'awaiting_assessment',
      resume: {
        original_filename: 'resume.pdf',
        file_type: 'application/pdf',
        file_size: 1000,
        uploaded_at: '2023-01-01T00:00:00Z',
      },
    } as any);
    
    vi.mocked(interviewService.listCandidateInterviews).mockResolvedValue([]);
  });

  it('renders both AI Analysis and Resume Validation cards on Candidate Profile', async () => {
    render(
      <MemoryRouter initialEntries={['/candidates/123']}>
        <Routes>
          <Route path="/candidates/:candidateId" element={<CandidateProfilePage user={{}} onLogout={() => {}} />} />
        </Routes>
      </MemoryRouter>
    );
    
    await waitFor(() => {
      expect(screen.getByText('Test Candidate')).toBeTruthy();
    });
    
    expect(screen.getByText('AI resume analysis')).toBeTruthy();
    expect(screen.getByText('Resume Validation')).toBeTruthy();
    
    // Check if correct navigation button exists
    const validateBtn = screen.getByText('Validate Resume');
    expect(validateBtn).toBeTruthy();
  });

  it('ResumeValidationPage handles loading, empty history, and start action', async () => {
    vi.mocked(validationService.getResumeValidationHistory).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(validationService.startResumeValidation).mockResolvedValue({} as any);

    render(
      <MemoryRouter initialEntries={['/candidates/123/resume-validation']}>
        <Routes>
          <Route path="/candidates/:candidateId/resume-validation" element={<ResumeValidationPage />} />
        </Routes>
      </MemoryRouter>
    );
    
    expect(screen.getByText('Loading...')).toBeTruthy();
    
    await waitFor(() => {
      expect(screen.getByText('No previous validation reports.')).toBeTruthy();
    });
    
    const startBtn = screen.getByText('Start Validation');
    expect(startBtn).toBeTruthy();
    
    fireEvent.click(startBtn);
    expect(validationService.startResumeValidation).toHaveBeenCalledWith('123', { target_role: 'Developer' });
  });

  it('ResumeValidationPage displays history items and processing states', async () => {
    const mockReports = [
      {
        id: 'r2',
        candidate_id: '123',
        target_role: 'Developer',
        validation_status: 'failed',
        error: 'Timeout error',
        created_at: '2023-01-02T00:00:00Z',
      },
      {
        id: 'r1',
        candidate_id: '123',
        target_role: 'Developer',
        validation_status: 'completed',
        overall_score: 85,
        created_at: '2023-01-01T00:00:00Z',
      }
    ] as any;
    
    vi.mocked(validationService.getResumeValidationHistory).mockResolvedValue({ items: mockReports, total: 2 });

    render(
      <MemoryRouter initialEntries={['/candidates/123/resume-validation']}>
        <Routes>
          <Route path="/candidates/:candidateId/resume-validation" element={<ResumeValidationPage />} />
        </Routes>
      </MemoryRouter>
    );
    
    await waitFor(() => {
      expect(screen.getByText('85 / 100')).toBeTruthy(); // Score rendered
      expect(screen.getByText('Completed')).toBeTruthy();
      expect(screen.getByText('Failed')).toBeTruthy();
    });
    
    expect(screen.getByText('Resume validation failed.')).toBeTruthy();
    expect(screen.getByText('Timeout error')).toBeTruthy();
  });

  it('Download PDF action calls api with blob request', async () => {
    const mockReport = {
      id: 'rep1',
      candidate_id: '123',
      target_role: 'Dev',
      validation_status: 'completed',
      overall_score: 75,
      created_at: '2023-01-01T00:00:00Z',
      category_scores: [],
      detailed_findings: [],
      suggested_questions: [],
    };
    vi.mocked(validationService.getResumeValidationReport).mockResolvedValue(mockReport as any);
    vi.mocked(validationService.downloadResumeValidationReport).mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={['/resume-validation/rep1']}>
        <Routes>
          <Route path="/resume-validation/:reportId" element={<ResumeValidationReportPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Download PDF/i).length).toBeGreaterThan(0);
    });
    
    fireEvent.click(screen.getAllByText(/Download PDF/i)[0]);
    
    expect(validationService.downloadResumeValidationReport).toHaveBeenCalled();
  });
});
