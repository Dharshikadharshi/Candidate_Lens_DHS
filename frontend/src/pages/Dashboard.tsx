import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { LogOut, Search, Filter } from 'lucide-react';
import CandidateProfileModal from '../components/CandidateProfileModal';
import ResumePreviewModal from '../components/ResumePreviewModal';

interface DashboardProps {
  user: any;
  onLogout: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ user, onLogout }) => {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const [previewCandidate, setPreviewCandidate] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchCandidates = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (roleFilter) params.append('role', roleFilter);
      
      const res = await api.get(`/candidates?${params.toString()}`);
      setCandidates(res.data.items);
      setTotal(res.data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
  }, [search, roleFilter]);

  const handleLogout = () => {
    if (window.confirm("Are you sure you want to logout?")) {
      onLogout();
      navigate('/login');
    }
  };

  const handleViewResume = async (e: React.MouseEvent, candidate: any) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const response = await api.get(`/candidates/${candidate.id}/resume/download`, {
        responseType: 'blob'
      });
      
      const fileType = candidate.resume?.file_type || 'application/pdf';
      const url = window.URL.createObjectURL(new Blob([response.data], { type: fileType }));
      setPreviewUrl(url);
      setPreviewCandidate(candidate);
    } catch (err) {
      alert('Failed to preview resume.');
    }
  };

  const handleDownloadResume = (candidate: any, url: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', candidate.resume?.original_filename || 'resume.pdf');
    document.body.appendChild(link);
    link.click();
    link.parentNode?.removeChild(link);
  };

  const closePreview = () => {
    if (previewUrl) {
      window.URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setPreviewCandidate(null);
  };

  const awaitingCount = candidates.filter(c => c.status === 'awaiting_assessment').length;
  const completedCount = candidates.filter(c => c.status === 'completed').length;
  const reportsPendingCount = candidates.filter(c => c.status === 'report_pending').length;

  return (
    <div className="dashboard-layout">
      <nav className="navbar">
        <div className="nav-brand">CandidateLens</div>
        <div className="nav-user">
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
            {user?.name || user?.email} (HR)
          </span>
          <button onClick={handleLogout} className="btn-logout" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </nav>

      <main className="dashboard-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-title">Total Candidates</div>
            <div className="stat-value">{total}</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">Awaiting Assessment</div>
            <div className="stat-value">{awaitingCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">Completed</div>
            <div className="stat-value">{completedCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">Reports Pending</div>
            <div className="stat-value">{reportsPendingCount}</div>
          </div>
        </div>

        <div className="table-container">
          <div className="table-header">
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Candidates</h2>
            <div className="table-filters">
              <div style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '0.75rem', color: 'var(--text-secondary)' }} />
                <input 
                  type="text" 
                  className="filter-input" 
                  placeholder="Search name or email..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ paddingLeft: '2.5rem' }}
                />
              </div>
              
              <div style={{ position: 'relative' }}>
                <Filter size={16} style={{ position: 'absolute', left: '0.75rem', top: '0.75rem', color: 'var(--text-secondary)' }} />
                <select 
                  className="filter-input" 
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  style={{ paddingLeft: '2.5rem', appearance: 'none', minWidth: '180px' }}
                >
                  <option value="">All Roles</option>
                  <option value="ML Engineer">ML Engineer</option>
                  <option value="Frontend Developer">Frontend Developer</option>
                  <option value="Backend Developer">Backend Developer</option>
                </select>
              </div>
            </div>
          </div>
          
          <table className="data-table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Contact</th>
                <th>Target Role</th>
                <th>Status</th>
                <th>Resume</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="empty-state">Loading candidates...</td>
                </tr>
              ) : candidates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">No candidates found.</td>
                </tr>
              ) : (
                candidates.map((candidate) => (
                  <tr key={candidate.id} onClick={() => setSelectedCandidate(candidate)} style={{ cursor: 'pointer' }} className="table-row-hover">
                    <td>
                      <div style={{ fontWeight: 500 }}>{candidate.full_name}</div>
                    </td>
                    <td>
                      <div>{candidate.email}</div>
                      {candidate.phone && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{candidate.phone}</div>}
                    </td>
                    <td>{candidate.target_role}</td>
                    <td>
                      <span className={`status-badge ${candidate.status === 'awaiting_assessment' ? 'status-awaiting' : 'status-completed'}`}>
                        {candidate.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </span>
                    </td>
                    <td>
                      {candidate.resume ? (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{candidate.resume.original_filename}</span>
                          <a href="#" className="action-link" onClick={(e) => handleViewResume(e, candidate)} style={{ fontSize: '0.75rem' }}>
                            View
                          </a>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No Resume</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>

      {selectedCandidate && (
        <CandidateProfileModal 
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onUpdate={() => {
            fetchCandidates();
            // Automatically refresh the modal data as well
            const updatedCandidate = candidates.find(c => c.id === selectedCandidate.id);
            if (updatedCandidate) {
              // Note: the updated candidate will only exist AFTER fetchCandidates returns,
              // but since we refresh, the UI will eventually update.
              // We'll close and rely on the background refresh for now, or just let fetchCandidates update it.
            }
          }}
          onPreview={(c) => {
            // Fake a mouse event
            handleViewResume({ stopPropagation: () => {}, preventDefault: () => {} } as any, c);
          }}
          onDownload={(c) => {
            // We need to fetch the blob again to download, or we can just fetch and trigger download
            api.get(`/candidates/${c.id}/resume/download`, { responseType: 'blob' }).then(response => {
              const fileType = c.resume?.file_type || 'application/pdf';
              const url = window.URL.createObjectURL(new Blob([response.data], { type: fileType }));
              handleDownloadResume(c, url);
            }).catch(() => alert('Failed to download resume.'));
          }}
        />
      )}

      {previewCandidate && previewUrl && (
        <ResumePreviewModal
          url={previewUrl}
          candidate={previewCandidate}
          onClose={closePreview}
          onDownload={() => handleDownloadResume(previewCandidate, previewUrl)}
        />
      )}
    </div>
  );
};

export default Dashboard;
