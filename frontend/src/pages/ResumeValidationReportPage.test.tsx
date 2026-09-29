import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResumeValidationReportPage from './ResumeValidationReportPage';
import * as validationService from '../services/resumeValidation';
import * as interviewsService from '../services/interviews';

// Mock the services
vi.mock('../services/resumeValidation');
vi.mock('../services/interviews');

describe('ResumeValidationReportPage', () => {
  const mockReport = {
    id: 'report-123',
    candidate_id: 'candidate-123',
    target_role: 'Frontend Developer',
    overall_score: 85,
    validation_status: 'completed',
    rubric_version: 'v1',
    category_scores: [
      { category: 'Completeness', score: 18, maximum_score: 20 },
      { category: 'Role Relevance', score: 20, maximum_score: 25 },
      { category: 'Skill Evidence', score: 22, maximum_score: 25 },
      { category: 'Consistency', score: 11, maximum_score: 15 },
      { category: 'Readability', score: 14, maximum_score: 15 }
    ],
    detailed_findings: [],
    suggested_questions: [
      { category: 'Technical', priority: 'High', question: 'Explain React hooks', rationale: 'Checks basic knowledge' }
    ],
    verification_summary: {
      contact: 'Detected',
      education: 'Detected',
      experience: 'Detected',
      skills: 'Detected',
      projects: 'Detected',
      certifications: 'Not mentioned',
      github: 'Detected',
      linkedin: 'Detected',
      portfolio: 'Not mentioned'
    },
    validation_pipeline: [
      { step: 'Extraction', status: 'completed', message: 'Done' }
    ],
    evidence: [
      { category: 'Skills', claim: 'React', evidence: 'Used in 3 projects', source: 'Projects', status: 'supported' }
    ],
    inconsistencies: [
      { type: 'Timeline', description: 'Overlapping dates', severity: 'low' }
    ],
    missing_information: [
      { item: 'Certifications', status: 'not_provided' }
    ],
    github_verification: { profile: { status: 'verified', public_repositories: 5, username: 'testuser' } },
    linkedin_verification: { status: 'restricted', message: 'Restricted access' },
    project_verification: [
      { project_name: 'AI Dashboard', description: 'Dashboard app', technologies: ['React'], claimed_features: [], claimed_frameworks: [] }
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockCandidate = {
    id: 'candidate-123',
    full_name: 'John Doe',
    email: 'john@example.com',
    target_role: 'Frontend Developer',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  const renderComponent = () => {
    return render(
      <MemoryRouter initialEntries={['/reports/report-123']}>
        <Routes>
          <Route path="/reports/:reportId" element={<ResumeValidationReportPage />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders loading state initially', () => {
    // Return a promise that never resolves for the test
    vi.mocked(validationService.getResumeValidationReport).mockReturnValue(new Promise(() => {}));
    
    renderComponent();
    expect(screen.getByText(/Loading report\.\.\./i)).toBeTruthy();
  });

  it('renders error state on failure', async () => {
    vi.mocked(validationService.getResumeValidationReport).mockRejectedValue(new Error('Network error'));
    
    renderComponent();
    
    await waitFor(() => {
      expect(screen.getByText(/Report not found\./i)).toBeTruthy();
    });
  });

  it('renders full report correctly', async () => {
    vi.mocked(validationService.getResumeValidationReport).mockResolvedValue(mockReport as any);
    vi.mocked(interviewsService.getCandidate).mockResolvedValue(mockCandidate as any);
    
    renderComponent();
    
    await waitFor(() => {
      expect(screen.getByText('John Doe — Frontend Developer')).toBeTruthy();
    });

    // Overall score
    expect(screen.getByText('85')).toBeTruthy();
    
    // Categories
    expect(screen.getAllByText('Completeness').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Role Relevance').length).toBeGreaterThan(0);
    
    // Pipeline
    expect(screen.getByText('Validation Pipeline')).toBeTruthy();
    
    // Github and LinkedIn
    expect(screen.getAllByText('GitHub').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LinkedIn').length).toBeGreaterThan(0);
    expect(screen.getByText(/Public repos: 5/i)).toBeTruthy();
    
    // Resume Sections
    expect(screen.getByText('contact')).toBeTruthy();
    
    // Evidence
    expect(screen.getByText('Evidence Found')).toBeTruthy();
    expect(screen.getAllByText('React').length).toBeGreaterThan(0);
    
    // Inconsistencies
    expect(screen.getByText('Potential Inconsistency Detected')).toBeTruthy();
    expect(screen.getByText('Overlapping dates')).toBeTruthy();
    
    // Missing Information
    expect(screen.getByText('Missing / Needs Review')).toBeTruthy();
    expect(screen.getAllByText(/Certifications/).length).toBeGreaterThan(0);
    
    // Project Verification
    expect(screen.getByText('AI Dashboard')).toBeTruthy();
    
    // Suggested Questions
    expect(screen.getByText('Explain React hooks')).toBeTruthy();
    
    // Action buttons
    expect(screen.getByText('Re-run')).toBeTruthy();
    expect(screen.getByText('Download PDF')).toBeTruthy();
    expect(screen.getByText('Print')).toBeTruthy();
  });
  
  it('renders empty optional data gracefully', async () => {
    const emptyReport = {
      ...mockReport,
      evidence: [],
      inconsistencies: [],
      missing_information: [],
      project_verification: [],
      suggested_questions: []
    };
    vi.mocked(validationService.getResumeValidationReport).mockResolvedValue(emptyReport as any);
    vi.mocked(interviewsService.getCandidate).mockResolvedValue(mockCandidate as any);
    
    renderComponent();
    
    await waitFor(() => {
      expect(screen.getByText('No evidence explicitly extracted.')).toBeTruthy();
      expect(screen.getByText('No obvious conflict detected')).toBeTruthy();
      expect(screen.getByText('No critical missing information detected')).toBeTruthy();
      expect(screen.getByText('No specific projects extracted for verification.')).toBeTruthy();
      expect(screen.getByText('No interview questions recommended.')).toBeTruthy();
    });
  });

  it('renders failed state correctly', async () => {
    const failedReport = {
      ...mockReport,
      validation_status: 'failed',
      error: 'AI service timeout'
    };
    vi.mocked(validationService.getResumeValidationReport).mockResolvedValue(failedReport as any);
    vi.mocked(interviewsService.getCandidate).mockResolvedValue(mockCandidate as any);
    
    renderComponent();
    
    await waitFor(() => {
      expect(screen.getByText('Validation Failed')).toBeTruthy();
      expect(screen.getByText('AI service timeout')).toBeTruthy();
    });
  });
});
