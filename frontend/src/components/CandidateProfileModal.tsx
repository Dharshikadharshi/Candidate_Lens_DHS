import React, { useState, useRef } from 'react';
import { api } from '../services/api';
import { X, Upload, FileText, Download } from 'lucide-react';

interface CandidateProfileModalProps {
  candidate: any;
  onClose: () => void;
  onUpdate: () => void;
  onPreview: (candidate: any) => void;
  onDownload: (candidate: any) => void;
}

const CandidateProfileModal: React.FC<CandidateProfileModalProps> = ({ candidate, onClose, onUpdate, onPreview, onDownload }) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setMessage('');
      setError('');
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    
    try {
      setUploading(true);
      setError('');
      setMessage('');
      
      const formData = new FormData();
      formData.append('file', file);
      
      await api.post(`/candidates/${candidate.id}/resume`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      setMessage('Resume uploaded successfully!');
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onUpdate();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to upload resume. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // Download and View are now handled by parent component passing down props


  return (
    <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="modal-content" style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '24px', width: '90%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0 }}>Candidate Profile</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h3>{candidate.full_name}</h3>
          <p style={{ margin: '4px 0', color: '#666' }}>{candidate.email} {candidate.phone && `• ${candidate.phone}`}</p>
          <p style={{ margin: '4px 0', color: '#666' }}>Target Role: {candidate.target_role}</p>
          <p style={{ margin: '4px 0', color: '#666' }}>Status: {candidate.status}</p>
        </div>

        <div style={{ borderTop: '1px solid #eee', paddingTop: '24px' }}>
          <h3 style={{ marginBottom: '16px' }}>Resume</h3>
          
          {candidate.resume ? (
            <div style={{ backgroundColor: '#f8f9fa', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <FileText size={24} color="#4f46e5" />
                <div>
                  <div style={{ fontWeight: 500 }}>{candidate.resume.original_filename}</div>
                  <div style={{ fontSize: '0.875rem', color: '#666' }}>
                    {(candidate.resume.file_size / 1024).toFixed(1)} KB • {new Date(candidate.resume.uploaded_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => onPreview(candidate)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', backgroundColor: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                  <FileText size={16} /> Preview
                </button>
                <button onClick={() => onDownload(candidate)} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', backgroundColor: '#e5e7eb', color: '#374151', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                  <Download size={16} /> Download
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '16px', border: '1px dashed #ccc', borderRadius: '8px', marginBottom: '16px', color: '#666' }}>
              No resume uploaded yet.
            </div>
          )}

          <div style={{ marginTop: '16px' }}>
            <h4 style={{ marginBottom: '8px' }}>{candidate.resume ? 'Update Resume' : 'Upload Resume'}</h4>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx"
                style={{ flex: 1 }}
              />
              <button 
                onClick={handleUpload} 
                disabled={!file || uploading}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', 
                  backgroundColor: file ? '#4f46e5' : '#ccc', 
                  color: 'white', border: 'none', borderRadius: '4px', cursor: file ? 'pointer' : 'not-allowed' 
                }}
              >
                <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '4px' }}>
              Supported formats: PDF, DOC, DOCX. Max size: 10MB.
            </div>
            
            {message && <div style={{ color: 'green', marginTop: '8px', fontSize: '0.875rem' }}>{message}</div>}
            {error && <div style={{ color: 'red', marginTop: '8px', fontSize: '0.875rem' }}>{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CandidateProfileModal;
