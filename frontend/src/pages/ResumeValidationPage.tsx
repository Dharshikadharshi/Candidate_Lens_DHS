import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileSearch, RefreshCw, FileText, Download, AlertTriangle } from 'lucide-react';
import { getCandidate, getErrorMessage } from '../services/interviews';
import { getResumeValidationHistory, startResumeValidation, downloadResumeValidationReport } from '../services/resumeValidation';
import type { CandidateDetail } from '../types/interview';
import type { ResumeValidationReport } from '../types/resumeValidation';
import { formatDate, formatDateTime } from '../utils/datetime';

const POLL_MS = 3000;

const ResumeValidationPage: React.FC = () => {
  const { candidateId = '' } = useParams();
  const navigate = useNavigate();

  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [reports, setReports] = useState<ResumeValidationReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionInProgress, setActionInProgress] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const activeReport = reports[0];
  const isProcessing = activeReport?.validation_status === 'pending' || activeReport?.validation_status === 'processing';

  const loadData = async () => {
    try {
      const [cData, rData] = await Promise.all([
        getCandidate(candidateId),
        getResumeValidationHistory(candidateId)
      ]);
      setCandidate(cData);
      setReports(rData.items);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load resume validation data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [candidateId]);

  useEffect(() => {
    if (!isProcessing) return;
    const timer = window.setInterval(async () => {
      try {
        const rData = await getResumeValidationHistory(candidateId);
        setReports(rData.items);
      } catch {
        // ignore polling errors
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [isProcessing, candidateId]);

  const handleStart = async () => {
    try {
      setActionInProgress(true);
      setError('');
      await startResumeValidation(candidateId, { target_role: candidate?.target_role });
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to start validation.'));
    } finally {
      setActionInProgress(false);
    }
  };

  const handleDownload = async (reportId: string, filename: string) => {
    try {
      setDownloadingId(reportId);
      await downloadResumeValidationReport(reportId, filename);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to download PDF.'));
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return <div className="dashboard-layout"><main className="dashboard-content"><div className="empty-state">Loading...</div></main></div>;
  }

  if (error && !candidate) {
    return (
      <div className="dashboard-layout">
        <main className="dashboard-content">
          <Link to={`/candidates/${candidateId}`} className="back-link"><ArrowLeft size={16} /> Back to candidate</Link>
          <div className="card empty-state" role="alert">{error}</div>
        </main>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return <span className="status-badge status-success">Completed</span>;
      case 'processing': 
      case 'pending': return <span className="status-badge status-awaiting">Processing...</span>;
      case 'failed': return <span className="status-badge status-danger">Failed</span>;
      default: return <span className="status-badge">{status}</span>;
    }
  };

  return (
    <div className="dashboard-layout">
      <main className="dashboard-content">
        <Link to={`/candidates/${candidateId}`} className="back-link"><ArrowLeft size={16} /> Back to candidate</Link>
        
        {error && (
          <div className="flash-error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss">✕</button>
          </div>
        )}

        <div className="profile-grid">
          <section className="card">
            <div className="profile-header">
              <div className="avatar" aria-hidden>{candidate?.full_name.charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <h1 className="profile-name">Resume Validation</h1>
                <div className="profile-role">{candidate?.full_name} · {candidate?.target_role}</div>
              </div>
            </div>
            
            <div className="button-row" style={{ marginTop: '1.5rem' }}>
              {!isProcessing && (
                <button 
                  className="btn-primary-sm" 
                  onClick={handleStart}
                  disabled={actionInProgress || !candidate?.resume}
                >
                  <FileSearch size={16} /> {reports.length > 0 ? 'Re-run Validation' : 'Start Validation'}
                </button>
              )}
            </div>
            
            {!candidate?.resume && (
              <div className="notice notice-warn" style={{ marginTop: '1rem' }}>
                <AlertTriangle size={16} /> No resume uploaded for this candidate.
              </div>
            )}
            
            {isProcessing && (
              <div className="empty-box" style={{ marginTop: '1rem', textAlign: 'center' }}>
                <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px auto', color: 'var(--primary-color)' }} />
                <div>Resume validation is in progress...</div>
                <div className="hint" style={{ marginTop: '4px' }}>This takes about 30 seconds.</div>
              </div>
            )}
            
            {activeReport?.validation_status === 'failed' && (
              <div className="empty-box" style={{ marginTop: '1rem', borderColor: 'var(--danger-color)', backgroundColor: '#fef2f2' }}>
                <AlertTriangle size={24} style={{ margin: '0 auto 12px auto', color: 'var(--danger-color)' }} />
                <div style={{ color: 'var(--danger-color)', fontWeight: 500 }}>Resume validation failed.</div>
                {activeReport.error && <div className="hint" style={{ marginTop: '4px' }}>{activeReport.error}</div>}
              </div>
            )}
          </section>
          
          <section className="card">
            <h2 className="card-title">Validation History</h2>
            {reports.length === 0 ? (
              <div className="empty-box">No previous validation reports.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Score</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report, idx) => (
                      <tr key={report.id} style={{ opacity: idx > 0 ? 0.7 : 1 }}>
                        <td>{formatDateTime(report.created_at)} {idx === 0 && <span className="status-badge" style={{ marginLeft: 6 }}>Latest</span>}</td>
                        <td>{getStatusBadge(report.validation_status)}</td>
                        <td>{report.validation_status === 'completed' ? `${report.overall_score || 0} / 100` : '—'}</td>
                        <td>
                          {report.validation_status === 'completed' && (
                            <div className="button-row" style={{ marginTop: 0 }}>
                              <button 
                                className="btn-secondary-sm"
                                onClick={() => navigate(`/resume-validation/${report.id}`)}
                              >
                                <FileText size={14} /> View
                              </button>
                              <button 
                                className="btn-secondary-sm"
                                onClick={() => handleDownload(report.id, `validation_${candidate?.full_name}_${formatDate(report.created_at)}.pdf`)}
                                disabled={downloadingId === report.id}
                              >
                                <Download size={14} /> {downloadingId === report.id ? 'Downloading...' : 'PDF'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default ResumeValidationPage;
