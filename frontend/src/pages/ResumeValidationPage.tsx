import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Award,
  CheckCircle,
  Download,
  FileCheck2,
  FileText,
  HelpCircle,
  History,
  Layers,
  Loader2,
  LogOut,
  Printer,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import {
  downloadValidationPdf,
  getCandidateValidationHistory,
  getValidationReport,
  regenerateValidationReport,
  startResumeValidation,
} from '../services/validation';
import { getCandidate, getErrorMessage } from '../services/interviews';
import type { CandidateDetail } from '../types/interview';
import type { ValidationHistoryResponse, ValidationReport } from '../types/validation';
import { formatDateTime } from '../utils/datetime';

interface ResumeValidationPageProps {
  user: any;
  onLogout: () => void;
}

const POLL_INTERVAL_MS = 2500;

const CATEGORY_CONFIG: Record<
  string,
  { title: string; max: number; icon: React.ReactNode; color: string; description: string }
> = {
  completeness: {
    title: 'Resume Completeness',
    max: 20,
    icon: <Layers size={18} />,
    color: '#3B82F6',
    description: 'Structure, contact details, education, work/internship experience, projects & certifications.',
  },
  role_relevance: {
    title: 'Target-Role Relevance',
    max: 25,
    icon: <Award size={18} />,
    color: '#8B5CF6',
    description: 'Alignment of candidate experience, projects and technical background with the role.',
  },
  skill_evidence: {
    title: 'Evidence Supporting Skills',
    max: 25,
    icon: <FileCheck2 size={18} />,
    color: '#10B981',
    description: 'Concrete proof in project descriptions or jobs for listed technical skills.',
  },
  consistency: {
    title: 'Internal Consistency',
    max: 15,
    icon: <ShieldAlert size={18} />,
    color: '#F59E0B',
    description: 'Chronological timeline, date overlap checks, and clarity of stated durations.',
  },
  readability: {
    title: 'Readability & Structure',
    max: 15,
    icon: <FileText size={18} />,
    color: '#6366F1',
    description: 'Formatting layout, parsing completeness, readability, and section organization.',
  },
};

const ResumeValidationPage: React.FC<ResumeValidationPageProps> = ({ user, onLogout }) => {
  const { candidateId = '', reportId = '' } = useParams();
  const navigate = useNavigate();

  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [historyData, setHistoryData] = useState<ValidationHistoryResponse | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [targetRoleInput, setTargetRoleInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'findings' | 'skills' | 'questions'>('all');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [findingFilter, setFindingFilter] = useState<'all' | 'verified' | 'needs_review' | 'clarification_recommended'>('all');

  const loadData = useCallback(async () => {
    try {
      setError('');
      if (reportId) {
        const rep = await getValidationReport(reportId);
        setReport(rep);
        setTargetRoleInput(rep.target_role);
        const c = await getCandidate(rep.candidate_id);
        setCandidate(c);
        const hist = await getCandidateValidationHistory(rep.candidate_id);
        setHistoryData(hist);
      } else if (candidateId) {
        const [c, hist] = await Promise.all([
          getCandidate(candidateId),
          getCandidateValidationHistory(candidateId),
        ]);
        setCandidate(c);
        setHistoryData(hist);
        if (hist.latest) {
          setReport(hist.latest);
          setTargetRoleInput(hist.latest.target_role || c.target_role);
        } else {
          setTargetRoleInput(c.target_role);
        }
      }
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to load validation details.'));
    } finally {
      setLoading(false);
    }
  }, [candidateId, reportId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Polling while processing
  useEffect(() => {
    if (report?.status !== 'processing') return;
    const interval = window.setInterval(async () => {
      try {
        if (report.id) {
          const fresh = await getValidationReport(report.id);
          setReport(fresh);
          if (fresh.status === 'completed') {
            setFlash('Resume validation completed successfully.');
            // Refresh history
            if (candidate?.id) {
              const hist = await getCandidateValidationHistory(candidate.id);
              setHistoryData(hist);
            }
          }
        }
      } catch {
        // ignore polling transient errors
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [report?.status, report?.id, candidate?.id]);

  const handleStartValidation = async (force = false) => {
    if (!candidate) return;
    setStarting(true);
    setError('');
    try {
      const rep = await startResumeValidation(candidate.id, targetRoleInput.trim() || undefined, force);
      setReport(rep);
      setFlash('Resume validation initiated.');
      const hist = await getCandidateValidationHistory(candidate.id);
      setHistoryData(hist);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not start resume validation.'));
    } finally {
      setStarting(false);
    }
  };

  const handleRegenerate = async () => {
    if (!report) return;
    setStarting(true);
    setError('');
    try {
      const fresh = await regenerateValidationReport(report.id, targetRoleInput.trim() || undefined);
      setReport(fresh);
      setFlash('Regenerating new validation version...');
      if (candidate?.id) {
        const hist = await getCandidateValidationHistory(candidate.id);
        setHistoryData(hist);
      }
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not regenerate validation.'));
    } finally {
      setStarting(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!report) return;
    setDownloading(true);
    try {
      const safeName = (candidate?.full_name || 'Candidate').replace(/\s+/g, '_');
      await downloadValidationPdf(report.id, `Resume_Validation_${safeName}_v${report.version}.pdf`);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to download PDF report.'));
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#059669'; // Green
    if (score >= 60) return '#D97706'; // Amber
    return '#DC2626'; // Red
  };

  const getScoreBadgeClass = (score: number) => {
    if (score >= 80) return 'status-accepted';
    if (score >= 60) return 'status-awaiting';
    return 'status-danger';
  };

  if (loading) {
    return (
      <div className="dashboard-layout">
        <main className="dashboard-content">
          <div className="empty-state">
            <Loader2 className="spin" size={32} style={{ margin: '0 auto 1rem' }} />
            Loading resume validation...
          </div>
        </main>
      </div>
    );
  }

  const effectiveCandidateId = candidate?.id || candidateId;

  return (
    <div className="dashboard-layout">
      {/* Navigation */}
      <nav className="navbar no-print">
        <Link to="/dashboard" className="nav-brand">
          CandidateLens
        </Link>
        <div className="nav-user">
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
            {user?.name || user?.email} (HR)
          </span>
          <button onClick={onLogout} className="btn-logout" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </nav>

      <main className="dashboard-content">
        <div className="no-print" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <Link to={`/candidates/${effectiveCandidateId}`} className="back-link">
            <ArrowLeft size={16} /> Back to candidate profile
          </Link>
          {historyData && historyData.history.length > 1 && (
            <button className="btn-secondary-sm" onClick={() => setShowHistoryModal(true)}>
              <History size={16} /> Report History ({historyData.history.length})
            </button>
          )}
        </div>

        {flash && (
          <div className="flash-success no-print" role="status">
            <span>{flash}</span>
            <button onClick={() => setFlash('')} aria-label="Dismiss">✕</button>
          </div>
        )}

        {error && (
          <div className="flash-error no-print" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss">✕</button>
          </div>
        )}

        {/* Candidate & Target Role Header */}
        <section className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="section-header" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                <span className="badge" style={{ backgroundColor: '#EEF2FF', color: '#4F46E5', fontWeight: 600 }}>
                  AI Resume Validation
                </span>
                {report && (
                  <span className="badge" style={{ backgroundColor: '#F3F4F6', color: '#374151' }}>
                    v{report.version} · Rubric {report.rubric_version}
                  </span>
                )}
                {report?.status === 'processing' && (
                  <span className="status-badge status-awaiting">
                    <Loader2 size={12} className="spin" /> Processing
                  </span>
                )}
                {report?.status === 'completed' && (
                  <span className="status-badge status-accepted">
                    <CheckCircle size={12} /> Validated
                  </span>
                )}
                {report?.status === 'failed' && (
                  <span className="status-badge status-danger">
                    <AlertCircle size={12} /> Failed
                  </span>
                )}
              </div>
              <h1 className="profile-name" style={{ margin: 0, fontSize: '1.75rem' }}>
                {candidate?.full_name || 'Candidate'}
              </h1>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Resume file: <strong>{report?.resume_filename || candidate?.resume?.original_filename || 'Not uploaded'}</strong>
                {report?.created_at && ` · Audited: ${formatDateTime(report.created_at)}`}
              </div>
            </div>

            {/* Role selection & Actions */}
            <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '280px' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="form-input"
                  style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
                  value={targetRoleInput}
                  onChange={(e) => setTargetRoleInput(e.target.value)}
                  placeholder="Target Role (e.g. Frontend Developer)"
                  disabled={starting || report?.status === 'processing'}
                  aria-label="Target Job Role"
                />
                {report?.status === 'completed' ? (
                  <button
                    className="btn-secondary-sm"
                    onClick={handleRegenerate}
                    disabled={starting}
                    title="Regenerate validation report for this role"
                  >
                    {starting ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Re-run
                  </button>
                ) : (
                  <button
                    className="btn-primary-sm"
                    onClick={() => handleStartValidation(false)}
                    disabled={starting || !candidate?.resume}
                  >
                    {starting ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Run
                  </button>
                )}
              </div>

              {report?.status === 'completed' && (
                <div className="button-row" style={{ marginTop: '0.25rem' }}>
                  <button className="btn-primary-sm" onClick={handleDownloadPdf} disabled={downloading}>
                    {downloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Download PDF
                  </button>
                  <button className="btn-secondary-sm" onClick={handlePrint}>
                    <Printer size={14} /> Print
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* State 1: No Resume Uploaded */}
        {!candidate?.resume && (
          <div className="card empty-state" role="alert">
            <AlertTriangle size={36} color="var(--warning-color)" style={{ margin: '0 auto 1rem' }} />
            <h3>No Resume Uploaded</h3>
            <p className="hint">This candidate does not have a resume on file. Please upload a PDF or DOCX resume to perform validation.</p>
            <Link to={`/candidates/${effectiveCandidateId}`} className="btn-primary-sm" style={{ marginTop: '1rem', display: 'inline-flex' }}>
              Return to Candidate Profile
            </Link>
          </div>
        )}

        {/* State 2: Processing */}
        {report?.status === 'processing' && (
          <section className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
            <Loader2 className="spin" size={40} color="var(--primary-color)" style={{ margin: '0 auto 1.5rem' }} />
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Auditing Resume Quality & Evidence...</h2>
            <p className="hint" style={{ maxWidth: '520px', margin: '0 auto' }}>
              Analyzing completeness, extracting evidence for technical claims against <strong>{report.target_role}</strong>, and checking chronological consistency.
            </p>
          </section>
        )}

        {/* State 3: Failed */}
        {report?.status === 'failed' && (
          <section className="card">
            <div className="flash-error" style={{ marginBottom: '1rem' }}>
              <AlertCircle size={18} />
              <span>Validation could not be completed: {report.error || 'Unknown error occurred.'}</span>
            </div>
            <button className="btn-primary-sm" onClick={() => handleStartValidation(true)} disabled={starting}>
              <RefreshCw size={14} /> Retry Validation
            </button>
          </section>
        )}

        {/* State 4: Completed Report */}
        {report?.status === 'completed' && (
          <>
            {/* Disclaimer Banner */}
            <div
              style={{
                backgroundColor: '#F3F4F6',
                borderLeft: '4px solid #6366F1',
                padding: '0.75rem 1rem',
                borderRadius: '4px',
                marginBottom: '1.5rem',
                fontSize: '0.85rem',
                color: '#374151',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
              }}
            >
              <HelpCircle size={20} color="#4F46E5" style={{ flexShrink: 0 }} />
              <div>
                <strong>Assessment Scope:</strong> This validation evaluates document structure, evidence coverage, and role relevance.
                It is <em>not</em> an automated hiring decision or personal guarantee of competence.
              </div>
            </div>

            {/* Score Overview Card */}
            <section className="card" style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2rem', alignItems: 'center' }}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '160px',
                    padding: '1.25rem',
                    borderRadius: '8px',
                    backgroundColor: '#F9FAFB',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Document Quality
                  </div>
                  <div
                    style={{
                      fontSize: '3rem',
                      fontWeight: 800,
                      color: getScoreColor(report.overall_score || 0),
                      lineHeight: 1.1,
                      margin: '0.25rem 0',
                    }}
                  >
                    {Math.round(report.overall_score || 0)}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>out of 100 points</div>
                  <div style={{ marginTop: '0.5rem' }}>
                    <span className={`status-badge ${getScoreBadgeClass(report.overall_score || 0)}`}>
                      {(report.overall_score || 0) >= 80 ? 'Strong Evidence' : (report.overall_score || 0) >= 60 ? 'Moderate Evidence' : 'Needs Review'}
                    </span>
                  </div>
                </div>

                <div>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>Executive Summary</h3>
                  <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: '1.5', color: '#1F2937' }}>
                    {report.summary}
                  </p>
                  {report.experience_level && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Evaluated experience level: <strong>{report.experience_level.toUpperCase()}</strong> (rubric rules adjusted to avoid penalizing entry-level profiles).
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Visual Category Analysis Chart */}
            <section className="card" style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h2 className="card-title" style={{ margin: 0 }}>Category Analysis & Evidence Coverage Chart</h2>
                  <p className="hint" style={{ margin: '0.25rem 0 0 0' }}>
                    Visual comparison across all 5 rubric categories against target role benchmarks.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: '#059669' }}></span>
                    Strong (≥75%)
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: '#D97706' }}></span>
                    Moderate (50–74%)
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: '#DC2626' }}></span>
                    Needs Review (&lt;50%)
                  </span>
                </div>
              </div>

              {/* Horizontal Bar Graph Comparison */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
                  const catScore = report.category_scores?.[key as keyof typeof report.category_scores];
                  const scoreVal = catScore?.score ?? 0;
                  const maxVal = config.max;
                  const pct = Math.min(100, Math.round((scoreVal / maxVal) * 100));
                  const barColor = pct >= 75 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626';

                  return (
                    <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: 600, color: '#111827', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                          <span style={{ color: config.color }}>{config.icon}</span>
                          {config.title}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <strong style={{ color: '#111827' }}>{scoreVal}</strong>
                          <span style={{ color: 'var(--text-secondary)' }}>/ {maxVal} pts</span>
                          <span style={{ fontWeight: 700, color: barColor, minWidth: '42px', textAlign: 'right' }}>
                            {pct}%
                          </span>
                        </span>
                      </div>

                      {/* Bar Track */}
                      <div style={{ height: '10px', width: '100%', backgroundColor: '#F3F4F6', borderRadius: '5px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            backgroundColor: barColor,
                            borderRadius: '5px',
                            transition: 'width 0.6s ease',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 5 Weighted Categories Breakdown */}
            <section className="card" style={{ marginBottom: '1.5rem' }}>
              <h2 className="card-title">Rubric Category Breakdown</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
                  const catScore = report.category_scores?.[key as keyof typeof report.category_scores];
                  const scoreVal = catScore?.score ?? 0;
                  const maxVal = config.max;
                  const pct = Math.min(100, Math.round((scoreVal / maxVal) * 100));

                  return (
                    <div
                      key={key}
                      style={{
                        padding: '1rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: '#FFFFFF',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: config.color, fontWeight: 600, fontSize: '0.85rem' }}>
                          {config.icon}
                          <span>{config.title}</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>
                          {scoreVal}
                        </span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          / {maxVal} pts
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: '0.8rem', fontWeight: 600, color: pct >= 75 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626' }}>
                          {pct}%
                        </span>
                      </div>

                      {/* Progress meter */}
                      <div style={{ height: '6px', width: '100%', backgroundColor: '#E5E7EB', borderRadius: '3px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            backgroundColor: pct >= 75 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626',
                            transition: 'width 0.4s ease',
                          }}
                        />
                      </div>

                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem', marginBottom: 0 }}>
                        {catScore?.summary || config.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Navigation Tabs */}
            <div className="no-print" style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem', gap: '0.5rem' }}>
              <button
                className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
                onClick={() => setActiveTab('all')}
                style={{ padding: '0.6rem 1rem', background: 'none', border: 'none', borderBottom: activeTab === 'all' ? '2px solid #4F46E5' : 'none', fontWeight: activeTab === 'all' ? 600 : 400, color: activeTab === 'all' ? '#4F46E5' : 'inherit', cursor: 'pointer' }}
              >
                All Findings ({report.detailed_findings?.length || 0})
              </button>
              <button
                className={`tab-btn ${activeTab === 'skills' ? 'active' : ''}`}
                onClick={() => setActiveTab('skills')}
                style={{ padding: '0.6rem 1rem', background: 'none', border: 'none', borderBottom: activeTab === 'skills' ? '2px solid #4F46E5' : 'none', fontWeight: activeTab === 'skills' ? 600 : 400, color: activeTab === 'skills' ? '#4F46E5' : 'inherit', cursor: 'pointer' }}
              >
                Skills Verification Map ({report.skills_evidence_map?.length || 0})
              </button>
              <button
                className={`tab-btn ${activeTab === 'questions' ? 'active' : ''}`}
                onClick={() => setActiveTab('questions')}
                style={{ padding: '0.6rem 1rem', background: 'none', border: 'none', borderBottom: activeTab === 'questions' ? '2px solid #4F46E5' : 'none', fontWeight: activeTab === 'questions' ? 600 : 400, color: activeTab === 'questions' ? '#4F46E5' : 'inherit', cursor: 'pointer' }}
              >
                Suggested Follow-up Questions ({report.suggested_questions?.length || 0})
              </button>
            </div>

            {/* Tab 1: Detailed Findings */}
            {(activeTab === 'all' || activeTab === 'findings') && (
              <section className="card" style={{ marginBottom: '1.5rem' }}>
                <div className="section-header no-print">
                  <h2 className="card-title" style={{ margin: 0 }}>Audit Findings & Evidence</h2>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Filter:</span>
                    <select
                      className="form-input"
                      style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                      value={findingFilter}
                      onChange={(e: any) => setFindingFilter(e.target.value)}
                    >
                      <option value="all">All Statuses</option>
                      <option value="verified">Verified in Resume</option>
                      <option value="needs_review">Needs Review</option>
                      <option value="clarification_recommended">Clarification Recommended</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                  {report.detailed_findings
                    ?.filter((f) => findingFilter === 'all' || f.review_status === findingFilter)
                    .map((finding, idx) => {
                      const catConf = CATEGORY_CONFIG[finding.category];
                      const accentColor = finding.review_status === 'verified' ? '#059669' : finding.review_status === 'needs_review' ? '#D97706' : '#6D28D9';
                      return (
                        <div
                          key={idx}
                          style={{
                            border: '1px solid var(--border-color)',
                            borderLeft: `4px solid ${accentColor}`,
                            borderRadius: '8px',
                            padding: '1.25rem',
                            backgroundColor: finding.review_status === 'verified' ? '#FAFAFA' : '#FFFDF7',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.65rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span
                                className="badge"
                                style={{
                                  backgroundColor: '#EEF2FF',
                                  color: catConf?.color || '#4F46E5',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                }}
                              >
                                {catConf?.title || finding.category}
                              </span>
                              <strong style={{ fontSize: '0.95rem', color: '#111827' }}>{finding.finding_description}</strong>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                {finding.score} / {finding.max_score} pts
                              </span>
                              {finding.review_status === 'verified' && (
                                <span className="status-badge status-accepted">
                                  <CheckCircle size={12} /> Verified
                                </span>
                              )}
                              {finding.review_status === 'needs_review' && (
                                <span className="status-badge status-awaiting">
                                  <AlertTriangle size={12} /> Needs Review
                                </span>
                              )}
                              {finding.review_status === 'clarification_recommended' && (
                                <span className="status-badge" style={{ backgroundColor: '#EDE9FE', color: '#6D28D9' }}>
                                  <HelpCircle size={12} /> Clarification Recommended
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Reasoning */}
                          <p style={{ margin: '0 0 0.65rem 0', fontSize: '0.85rem', color: '#374151', lineHeight: '1.5' }}>
                            {finding.reasoning}
                          </p>

                          {/* Verbatim quote / excerpt */}
                          {finding.relevant_excerpt && (
                            <div
                              style={{
                                backgroundColor: '#F3F4F6',
                                borderLeft: `3px solid ${catConf?.color || '#9CA3AF'}`,
                                padding: '0.5rem 0.85rem',
                                fontSize: '0.8rem',
                                fontStyle: 'italic',
                                color: '#4B5563',
                                marginBottom: '0.65rem',
                                borderRadius: '0 6px 6px 0',
                              }}
                            >
                              “{finding.relevant_excerpt}”
                              {finding.section_or_page && (
                                <span style={{ fontStyle: 'normal', color: '#6B7280', marginLeft: '0.5rem' }}>
                                  — {finding.section_or_page}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Recommended Action */}
                          {finding.recommended_action && (
                            <div
                              style={{
                                backgroundColor: '#EEF2FF',
                                border: '1px solid #E0E7FF',
                                borderRadius: '6px',
                                padding: '0.5rem 0.75rem',
                                fontSize: '0.8rem',
                                color: '#1E1B4B',
                              }}
                            >
                              <strong style={{ color: '#4F46E5', marginRight: '0.35rem' }}>💡 Recruiter Action:</strong>
                              {finding.recommended_action}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </section>
            )}

            {/* Tab 2: Skills Evidence Map */}
            {(activeTab === 'all' || activeTab === 'skills') && (
              <section className="card" style={{ marginBottom: '1.5rem' }}>
                <h2 className="card-title">Skills Evidence Verification Map</h2>
                <p className="hint">
                  Distinguishes between skills supported by project or work context versus unverified keyword listings.
                </p>

                <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
                  <table className="table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border-color)', fontSize: '0.85rem' }}>
                        <th style={{ padding: '0.5rem' }}>Skill / Requirement</th>
                        <th style={{ padding: '0.5rem' }}>Validation Status</th>
                        <th style={{ padding: '0.5rem' }}>Supporting Resume Evidence</th>
                        <th style={{ padding: '0.5rem' }}>Location / Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.skills_evidence_map?.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                          <td style={{ padding: '0.6rem 0.5rem', fontWeight: 600 }}>{item.skill}</td>
                          <td style={{ padding: '0.6rem 0.5rem' }}>
                            {item.status === 'supported' && (
                              <span className="status-badge status-accepted">
                                <CheckCircle size={12} /> Supported
                              </span>
                            )}
                            {item.status === 'unsupported' && (
                              <span className="status-badge status-awaiting">
                                <AlertTriangle size={12} /> Listed Without Evidence
                              </span>
                            )}
                            {item.status === 'not_mentioned' && (
                              <span className="status-badge" style={{ backgroundColor: '#F3F4F6', color: '#6B7280' }}>
                                Not Mentioned
                              </span>
                            )}
                            {item.status === 'indeterminate' && (
                              <span className="status-badge" style={{ backgroundColor: '#EDE9FE', color: '#6D28D9' }}>
                                Indeterminate
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.6rem 0.5rem', color: '#374151' }}>
                            {item.evidence_excerpt ? (
                              <span style={{ fontStyle: 'italic' }}>“{item.evidence_excerpt}”</span>
                            ) : (
                              <span style={{ color: 'var(--text-secondary)' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '0.6rem 0.5rem', color: 'var(--text-secondary)' }}>
                            {item.notes || item.section_or_page || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Tab 3: Suggested Follow-up Questions */}
            {(activeTab === 'all' || activeTab === 'questions') && (
              <section className="card" style={{ marginBottom: '1.5rem' }}>
                <h2 className="card-title">Recommended Interview Follow-Up Questions</h2>
                <p className="hint">
                  Questions to ask during screening or the technical interview to verify self-reported skills and clarify evidence gaps.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
                  {report.suggested_questions?.map((q, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '0.75rem 1rem',
                        backgroundColor: '#F9FAFB',
                        borderRadius: '6px',
                        borderLeft: '3px solid #4F46E5',
                        fontSize: '0.9rem',
                        lineHeight: 1.4,
                      }}
                    >
                      <strong style={{ color: '#4F46E5', marginRight: '0.5rem' }}>Q{idx + 1}.</strong>
                      {q}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Assessment Limitations & Document Scope */}
            <section className="card" style={{ marginBottom: '1.5rem', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <ShieldAlert size={20} color="#6B7280" style={{ marginTop: '0.2rem', flexShrink: 0 }} />
                <div>
                  <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '0.95rem', fontWeight: 600, color: '#374151' }}>
                    Assessment Limitations & Document Scope
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#6B7280', lineHeight: 1.5 }}>
                    This validation score reflects resume document quality and evidence coverage only. It does not verify candidate identity, honesty, or eventual job performance. Findings should serve as structured guidance for HR interview clarification rather than automated hiring decisions.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {/* History Modal */}
      {showHistoryModal && historyData && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2>Report History — {candidate?.full_name}</h2>
              <button className="btn-close" onClick={() => setShowHistoryModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {historyData.history.map((h) => (
                  <div
                    key={h.id}
                    style={{
                      border: '1px solid var(--border-color)',
                      padding: '0.75rem 1rem',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: h.id === report?.id ? '#EEF2FF' : '#FFFFFF',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                        Version {h.version} · {h.target_role}
                        {h.id === report?.id && (
                          <span className="badge" style={{ marginLeft: '0.5rem', backgroundColor: '#4F46E5', color: '#FFF' }}>
                            Current
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Created {formatDateTime(h.created_at)}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      {h.overall_score != null && (
                        <div style={{ fontWeight: 700, fontSize: '1.1rem', color: getScoreColor(h.overall_score) }}>
                          {Math.round(h.overall_score)} / 100
                        </div>
                      )}
                      <button
                        className="btn-secondary-sm"
                        onClick={() => {
                          setShowHistoryModal(false);
                          navigate(`/resume-validation/${h.id}`);
                        }}
                      >
                        View
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResumeValidationPage;
