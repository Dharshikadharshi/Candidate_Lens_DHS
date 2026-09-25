import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { LogOut, Search, Filter } from 'lucide-react';
import CandidateProfileModal from '../components/CandidateProfileModal';
import ResumePreviewModal from '../components/ResumePreviewModal';
import AddCandidateModal from '../components/AddCandidateModal';

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
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [candidateToDelete, setCandidateToDelete] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
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

  const handleStatusChange = async (candidateId: string, newStatus: string) => {
    try {
      setSuccessMessage('');
      const res = await api.patch(`/candidates/${candidateId}/status`, { status: newStatus });
      setCandidates(prev => prev.map(c => c.id === candidateId ? res.data : c));
      setSuccessMessage('Status updated successfully.');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      alert('Failed to update status.');
    }
  };

  const handleDeleteCandidate = async () => {
    if (!candidateToDelete) return;
    try {
      setIsDeleting(true);
      await api.delete(`/candidates/${candidateToDelete.id}`);
      setCandidates(prev => prev.filter(c => c.id !== candidateToDelete.id));
      setTotal(prev => prev - 1);
      setCandidateToDelete(null);
      setSuccessMessage('Candidate deleted successfully.');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      alert('Failed to delete candidate.');
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'awaiting_assessment': return 'status-awaiting';
      case 'assessment_in_progress': return 'status-in-progress';
      case 'completed': return 'status-completed';
      case 'report_pending': return 'status-report-pending';
      default: return '';
    }
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

        {successMessage && (
          <div style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '12px 16px', borderRadius: '6px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{successMessage}</span>
            <button onClick={() => setSuccessMessage('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#166534' }}>✕</button>
          </div>
        )}

        <div className="table-container">
          <div className="table-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Candidates</h2>
              <button 
                onClick={() => setIsAddModalOpen(true)}
                style={{ padding: '6px 12px', backgroundColor: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem', display: 'flex', alignItems: 'center' }}
              >
                + Add Candidate
              </button>
            </div>
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="empty-state">Loading candidates...</td>
                </tr>
              ) : candidates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">No candidates found.</td>
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
                    <td onClick={(e) => e.stopPropagation()}>
                      <select 
                        value={candidate.status}
                        onChange={(e) => handleStatusChange(candidate.id, e.target.value)}
                        className={`status-badge ${getStatusClass(candidate.status)}`}
                        style={{ appearance: 'none', border: 'none', cursor: 'pointer', paddingRight: '20px', backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23333%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right .5rem top 50%', backgroundSize: '.65rem auto' }}
                      >
                        <option className="status-awaiting" value="awaiting_assessment">Awaiting Assessment</option>
                        <option className="status-in-progress" value="assessment_in_progress">Assessment In Progress</option>
                        <option className="status-completed" value="completed">Completed</option>
                        <option className="status-report-pending" value="report_pending">Report Pending</option>
                      </select>
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
                    <td onClick={(e) => e.stopPropagation()}>
                      <button 
                        onClick={() => setCandidateToDelete(candidate)}
                        style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
                      >
                        Delete
                      </button>
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

      {isAddModalOpen && (
        <AddCandidateModal
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={() => {
            setIsAddModalOpen(false);
            setSuccessMessage('Candidate added successfully.');
            fetchCandidates();
            setTimeout(() => setSuccessMessage(''), 3000);
          }}
        />
      )}

      {candidateToDelete && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '24px', width: '90%', maxWidth: '400px' }}>
            <h2 style={{ marginTop: 0, marginBottom: '16px' }}>Delete Candidate?</h2>
            <p style={{ marginBottom: '8px' }}>Are you sure you want to delete:</p>
            <p style={{ fontWeight: 'bold', marginBottom: '16px' }}>{candidateToDelete.full_name}</p>
            <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: '24px' }}>This action cannot be undone.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button 
                onClick={() => setCandidateToDelete(null)}
                disabled={isDeleting}
                style={{ padding: '8px 16px', backgroundColor: '#e5e7eb', color: '#374151', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
              >
                Cancel
              </button>
              <button 
                onClick={handleDeleteCandidate}
                disabled={isDeleting}
                style={{ padding: '8px 16px', backgroundColor: '#dc2626', color: 'white', border: 'none', borderRadius: '4px', cursor: isDeleting ? 'not-allowed' : 'pointer', fontWeight: 500 }}
              >
                {isDeleting ? 'Deleting...' : 'Delete Candidate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
