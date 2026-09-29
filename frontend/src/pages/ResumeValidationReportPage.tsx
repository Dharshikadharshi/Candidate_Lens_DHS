import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Printer, RefreshCw, AlertCircle, CheckCircle, HelpCircle, Check, ShieldAlert, AlertTriangle, ShieldCheck } from 'lucide-react';
import { getCandidate, getErrorMessage } from '../services/interviews';
import { 
  getResumeValidationReport, 
  regenerateResumeValidation, 
  downloadResumeValidationReport 
} from '../services/resumeValidation';
import type { CandidateDetail } from '../types/interview';
import type { ResumeValidationReport } from '../types/resumeValidation';
import { formatDate } from '../utils/datetime';

const ScoreRing = ({ score }: { score: number }) => {
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  
  const getColor = (s: number) => {
    if (s >= 80) return 'var(--success-color, #10B981)';
    if (s >= 60) return 'var(--warning-color, #F59E0B)';
    return 'var(--danger-color, #EF4444)';
  };

  return (
    <div style={{ position: 'relative', width: '120px', height: '120px', margin: '0 auto' }}>
      <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={radius} stroke="var(--border-color)" strokeWidth="8" fill="none" />
        <circle 
          cx="60" cy="60" r={radius} 
          stroke={getColor(score)} 
          strokeWidth="8" 
          fill="none" 
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
        />
      </svg>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '1.75rem', fontWeight: 'bold', lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>/ 100</div>
      </div>
    </div>
  );
};

const HorizontalBar = ({ label, score, max }: { label: string, score: number, max: number }) => {
  const percent = Math.min(100, Math.max(0, (score / max) * 100));
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.875rem' }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ color: 'var(--text-secondary)' }}>{score} / {max} ({Math.round(percent)}%)</span>
      </div>
      <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${percent}%`, height: '100%', backgroundColor: 'var(--primary-color)', borderRadius: '4px', transition: 'width 1s ease' }} />
      </div>
    </div>
  );
};

const ResumeValidationReportPage: React.FC = () => {
  const { reportId = '' } = useParams();
  const navigate = useNavigate();

  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [report, setReport] = useState<ResumeValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionInProgress, setActionInProgress] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const loadData = async () => {
    try {
      const rData = await getResumeValidationReport(reportId);
      setReport(rData);
      
      try {
        const cData = await getCandidate(rData.candidate_id);
        setCandidate(cData);
      } catch (cErr) {
        // Handle if candidate is deleted but report exists
      }
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load report.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [reportId]);

  const handleRegenerate = async () => {
    if (!report) return;
    if (!window.confirm('Are you sure you want to re-run validation? This will create a new report.')) return;
    
    try {
      setActionInProgress(true);
      setError('');
      await regenerateResumeValidation(report.id);
      navigate(`/candidates/${report.candidate_id}/resume-validation`);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to re-run validation.'));
      setActionInProgress(false);
    }
  };

  const handleDownload = async () => {
    if (!report) return;
    try {
      setDownloading(true);
      const filename = `validation_${candidate?.full_name || 'candidate'}_${formatDate(report.created_at)}.pdf`;
      await downloadResumeValidationReport(report.id, filename);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to download PDF.'));
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <div className="dashboard-layout"><main className="dashboard-content"><div className="empty-state">Loading report...</div></main></div>;
  }

  if (error || !report) {
    return (
      <div className="dashboard-layout">
        <main className="dashboard-content">
          <button className="back-link btn-link" onClick={() => navigate(-1)}><ArrowLeft size={16} /> Back</button>
          <div className="card empty-state" role="alert">{error || 'Report not found.'}</div>
        </main>
      </div>
    );
  }


  
  const StatusIcon = ({ status }: { status: string }) => {
    if (status.includes('verified') || status === 'supported' || status === 'completed') return <ShieldCheck size={16} style={{ color: 'var(--success-color, #10B981)' }} />;
    if (status.includes('unavailable') || status.includes('missing') || status === 'not_provided') return <AlertTriangle size={16} style={{ color: 'var(--warning-color, #F59E0B)' }} />;
    if (status.includes('invalid') || status === 'failed') return <ShieldAlert size={16} style={{ color: 'var(--danger-color, #EF4444)' }} />;
    return <HelpCircle size={16} style={{ color: 'var(--text-secondary)' }} />;
  };

  return (
    <div className="dashboard-layout print-friendly">
      <main className="dashboard-content">
        <div className="no-print button-row" style={{ marginBottom: '1rem', justifyContent: 'space-between' }}>
          <Link to={`/candidates/${report.candidate_id}/resume-validation`} className="back-link" style={{ margin: 0 }}>
            <ArrowLeft size={16} /> Back to Validation History
          </Link>
          <div className="button-row" style={{ margin: 0 }}>
            <button className="btn-secondary-sm" onClick={handlePrint}><Printer size={16} /> Print</button>
            <button className="btn-secondary-sm" onClick={handleDownload} disabled={downloading}>
              <Download size={16} /> {downloading ? 'Downloading...' : 'Download PDF'}
            </button>
            <button className="btn-primary-sm" onClick={handleRegenerate} disabled={actionInProgress}>
              <RefreshCw size={16} /> Re-run
            </button>
          </div>
        </div>

        {error && (
          <div className="flash-error no-print" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss">✕</button>
          </div>
        )}

        <section className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--primary-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 className="profile-name">Resume Validation Report</h1>
              <div className="profile-role">{candidate?.full_name || 'Candidate'} — {report.target_role}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Status</div>
              <div style={{ fontWeight: 600, textTransform: 'capitalize', color: report.validation_status === 'completed' ? 'var(--success-color, #10B981)' : 'var(--warning-color)' }}>
                {report.validation_status}
              </div>
            </div>
          </div>
        </section>

        {report.validation_status === 'failed' ? (
          <section className="card" style={{ marginTop: '1.5rem' }}>
            <div className="empty-box" style={{ borderColor: 'var(--danger-color)', backgroundColor: '#fef2f2' }}>
              <AlertCircle size={24} style={{ margin: '0 auto 12px auto', color: 'var(--danger-color)' }} />
              <div style={{ color: 'var(--danger-color)', fontWeight: 500 }}>Validation Failed</div>
              <div className="hint" style={{ marginTop: '4px' }}>{report.error || 'An unexpected error occurred during AI analysis.'}</div>
            </div>
          </section>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
            <section className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
              <h2 className="card-title" style={{ alignSelf: 'flex-start' }}>Overall Score</h2>
              <div style={{ margin: '1.5rem 0' }}>
                <ScoreRing score={report.overall_score ?? 0} />
              </div>
              <div style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Validation Score<br/>
                <strong style={{ color: 'var(--success-color, #10B981)' }}>✓ Validation Completed</strong>
              </div>
            </section>
            <section className="card">
              <h2 className="card-title">Category Performance</h2>
              <div style={{ marginTop: '1.5rem' }}>
                {report.category_scores.map((c, i) => (
                  <HorizontalBar key={i} label={c.category} score={c.score} max={c.maximum_score} />
                ))}
              </div>
            </section>
          </div>
        )}

        {report.validation_status === 'completed' && (
          <>
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {report.category_scores.map((c, i) => {
                const isStrong = c.score / c.maximum_score >= 0.8;
                return (
                  <div key={i} className="card" style={{ padding: '1rem' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{c.category}</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{c.score} <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>/ {c.maximum_score}</span></div>
                    <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '4px', color: isStrong ? 'var(--success-color, #10B981)' : 'var(--warning-color, #F59E0B)' }}>
                      {isStrong ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                      {isStrong ? 'Strong' : 'Review Needed'}
                    </div>
                  </div>
                );
              })}
            </section>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
              <section className="card">
                <h2 className="card-title">Validation Pipeline</h2>
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {(report.validation_pipeline || []).map((step: any, i: number) => (
                    <div key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                      <div style={{ marginTop: '2px' }}>
                        <StatusIcon status={step.status} />
                      </div>
                      <div>
                        <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{step.step.replace(/_/g, ' ')}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{step.message}</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <CheckCircle size={16} style={{ color: 'var(--success-color, #10B981)', marginTop: '2px' }} />
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>report generated</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Final report compiled.</div>
                    </div>
                  </div>
                </div>
              </section>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <section className="card">
                  <h2 className="card-title">External Verification</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '1rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                        <span>GitHub</span>
                      </div>
                      {report.github_verification ? (
                        <div style={{ fontSize: '0.875rem' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '4px' }}>
                            <StatusIcon status={report.github_verification.profile?.status || report.github_verification.status || 'not_verified'} />
                            <span>{report.github_verification.profile?.status === 'verified' ? 'Profile verified' : (report.github_verification.profile?.message || report.github_verification.message || 'Not verified')}</span>
                          </div>
                          {report.github_verification.profile?.status === 'verified' && (
                            <div style={{ paddingLeft: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                              Username: {report.github_verification.profile.username}<br/>
                              Public repos: {report.github_verification.profile.public_repositories}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>— Not provided</div>
                      )}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                        <span>LinkedIn</span>
                      </div>
                      {report.linkedin_verification ? (
                        <div style={{ fontSize: '0.875rem' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <StatusIcon status={report.linkedin_verification.status} />
                            <span>{report.linkedin_verification.message || 'Not verified'}</span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>— Not provided</div>
                      )}
                    </div>
                  </div>
                </section>

                <section className="card">
                  <h2 className="card-title">Resume Sections</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                    {report.verification_summary && Object.entries(report.verification_summary).map(([key, val]) => (
                      <div key={key} style={{ fontSize: '0.875rem' }}>
                        <div style={{ fontWeight: 500, textTransform: 'capitalize', marginBottom: '2px' }}>{key}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
                          {String(val).toLowerCase().includes('detected') || String(val).toLowerCase().includes('present') ? <Check size={14} style={{color: 'var(--success-color)'}}/> : <AlertTriangle size={14} />}
                          <span style={{ fontSize: '0.75rem' }}>{val}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>

            <section className="card" style={{ marginBottom: '1.5rem' }}>
              <h2 className="card-title">Evidence Found</h2>
              {report.evidence && report.evidence.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                  {report.evidence.map((ev, i) => (
                    <div key={i} style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.875rem' }}>
                      <div style={{ fontWeight: 600, marginBottom: '4px' }}>{ev.claim}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', color: ev.status === 'supported' ? 'var(--success-color, #10B981)' : 'var(--warning-color, #F59E0B)' }}>
                        <StatusIcon status={ev.status} /> {ev.evidence || (ev.status === 'supported' ? 'Evidence found' : 'No supporting evidence found')}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Source: {ev.source}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-box" style={{ marginTop: '1rem' }}>No evidence explicitly extracted.</div>
              )}
            </section>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
              <section className="card">
                <h2 className="card-title">Consistency Checks</h2>
                {report.inconsistencies && report.inconsistencies.length > 0 ? (
                  <ul className="plain-list" style={{ marginTop: '1rem' }}>
                    {report.inconsistencies.map((inc, i) => (
                      <li key={i} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '4px' }}>
                          <AlertTriangle size={16} style={{ color: 'var(--warning-color, #F59E0B)' }} />
                          <strong style={{ fontSize: '0.875rem' }}>Potential Inconsistency Detected</strong>
                        </div>
                        <div style={{ fontSize: '0.875rem', marginTop: '4px' }}><strong>Issue:</strong> {inc.type}</div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{inc.description}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
                    <CheckCircle size={16} style={{ color: 'var(--success-color, #10B981)' }} />
                    No obvious conflict detected
                  </div>
                )}
              </section>

              <section className="card">
                <h2 className="card-title">Missing / Needs Review</h2>
                {report.missing_information && report.missing_information.length > 0 ? (
                  <ul className="plain-list" style={{ marginTop: '1rem' }}>
                    {report.missing_information.map((m, i) => (
                      <li key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                        <AlertTriangle size={16} style={{ color: 'var(--warning-color, #F59E0B)' }} />
                        {m.item} <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>({m.status})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
                    <CheckCircle size={16} style={{ color: 'var(--success-color, #10B981)' }} />
                    No critical missing information detected
                  </div>
                )}
              </section>
            </div>

            <section className="card" style={{ marginBottom: '1.5rem' }}>
              <h2 className="card-title">Project Verification</h2>
              
              {report.github_verification?.project_matches && report.github_verification.project_matches.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '1rem' }}>GitHub Matches</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
                    {report.github_verification.project_matches.map((match, i) => (
                      <div key={i} style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                          <h4 style={{ fontSize: '1rem', margin: 0, fontWeight: 600 }}>{match.resume_project}</h4>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '12px' }}>
                            <StatusIcon status={match.status} /> {match.status.replace('_', ' ').toUpperCase()}
                          </div>
                        </div>
                        <div style={{ fontSize: '0.875rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                          <strong>Repository:</strong> {match.repository || 'Not found'}
                          {match.repository_url && <a href={match.repository_url} target="_blank" rel="noreferrer" style={{ marginLeft: '8px' }}>View</a>}
                        </div>
                        
                        <div style={{ fontSize: '0.75rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span>Match Confidence:</span>
                            <strong>{Math.round(match.confidence * 100)}%</strong>
                          </div>
                          <div style={{ height: '4px', backgroundColor: 'var(--border-color)', borderRadius: '2px', marginBottom: '1rem', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${match.confidence * 100}%`, backgroundColor: match.confidence > 0.7 ? 'var(--success-color, #10B981)' : 'var(--warning-color, #F59E0B)' }} />
                          </div>
                        </div>
                        
                        {match.technology_evidence && match.technology_evidence.length > 0 && (
                          <div style={{ fontSize: '0.875rem', marginBottom: '8px' }}>
                            <strong>Found Tech:</strong> {match.technology_evidence.join(', ')}
                          </div>
                        )}
                        {match.missing_claims && match.missing_claims.length > 0 && (
                          <div style={{ fontSize: '0.875rem', color: 'var(--warning-color, #d97706)' }}>
                            <strong>Missing Evidence:</strong> {match.missing_claims.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.project_verification && report.project_verification.length > 0 ? (
                <div>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '1rem' }}>Resume Claims</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
                    {report.project_verification.map((proj, i) => (
                      <div key={i} style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                        <h4 style={{ fontSize: '1rem', margin: '0 0 0.5rem 0' }}>{proj.project_name}</h4>
                        <p style={{ fontSize: '0.875rem', margin: '0 0 1rem 0' }}>{proj.description}</p>
                        
                        <div style={{ fontSize: '0.875rem', marginBottom: '4px' }}><strong>Technologies:</strong> {proj.technologies?.join(', ')}</div>
                        <div style={{ fontSize: '0.875rem', marginBottom: '4px' }}><strong>Features:</strong> {proj.claimed_features?.join(', ')}</div>
                        <div style={{ fontSize: '0.875rem', marginBottom: '4px' }}><strong>Frameworks:</strong> {proj.claimed_frameworks?.join(', ')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                (!report.github_verification?.project_matches || report.github_verification.project_matches.length === 0) && (
                  <div className="empty-box" style={{ marginTop: '1rem' }}>No specific projects extracted for verification.</div>
                )
              )}
            </section>

            <section className="card" style={{ marginBottom: '1.5rem' }}>
              <h2 className="card-title">Recommended Interview Questions</h2>
              {report.suggested_questions && report.suggested_questions.length > 0 ? (
                <div style={{ marginTop: '1rem' }}>
                  {/* Group by category */}
                  {Array.from(new Set(report.suggested_questions.map(q => q.category || 'General'))).map(cat => (
                    <div key={cat} style={{ marginBottom: '1.5rem' }}>
                      <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--primary-color)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>{cat}</h3>
                      <ul className="plain-list">
                        {report.suggested_questions.filter(q => (q.category || 'General') === cat).map((q, i) => (
                          <li key={i} style={{ marginBottom: '0.75rem', paddingLeft: '1rem', borderLeft: '2px solid var(--border-color)' }}>
                            <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{q.question}</div>
                            {q.rationale && <div className="hint">{q.rationale}</div>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-box" style={{ marginTop: '1rem' }}>No interview questions recommended.</div>
              )}
            </section>

            <section className="card" style={{ marginBottom: '1.5rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <h2 className="card-title" style={{ textAlign: 'center' }}>What Happens Next?</h2>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '2rem', padding: '0 1rem', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '16px', left: '10%', right: '10%', height: '2px', backgroundColor: 'var(--border-color)', zIndex: 0 }} />
                
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', zIndex: 1, width: '20%' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--success-color, #10B981)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}><Check size={16} /></div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, textAlign: 'center' }}>Validation Complete</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', zIndex: 1, width: '20%' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'white', border: '2px solid var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>2</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, textAlign: 'center' }}>Review flagged items</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', zIndex: 1, width: '20%' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'white', border: '2px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>3</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, textAlign: 'center', color: 'var(--text-secondary)' }}>Technical Interview</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', zIndex: 1, width: '20%' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'white', border: '2px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>4</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, textAlign: 'center', color: 'var(--text-secondary)' }}>HR Decision</div>
                </div>
              </div>
              <div style={{ textAlign: 'center', marginTop: '1.5rem', fontWeight: 600, color: 'var(--primary-color)' }}>
                Ready for HR Review
              </div>
            </section>
          </>
        )}

        <section className="card" style={{ marginTop: '1.5rem', backgroundColor: 'var(--bg-secondary)' }}>
          <h2 className="card-title" style={{ fontSize: '1rem' }}>Assessment Limitations</h2>
          <p className="hint">
            This report evaluates the resume document and available evidence. It does not independently authenticate the candidate's claims or determine candidate competence or hiring suitability.
          </p>
        </section>
        
        <div className="no-print" style={{ marginTop: '2rem', textAlign: 'center' }}>
          <Link to={`/candidates/${report.candidate_id}`} className="link-button">
            Back to Candidate Profile
          </Link>
        </div>
      </main>
    </div>
  );
};

export default ResumeValidationReportPage;
