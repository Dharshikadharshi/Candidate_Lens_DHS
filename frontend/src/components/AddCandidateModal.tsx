import React, { useState, useRef } from 'react';
import { api } from '../services/api';
import { X, UserPlus } from 'lucide-react';

interface AddCandidateModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const AddCandidateModal: React.FC<AddCandidateModalProps> = ({ onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    targetRole: 'ML Engineer'
  });
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    } else {
      setFile(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName || !formData.email || !formData.phone || !formData.targetRole) {
      setError('Please fill in all required fields.');
      return;
    }

    if (file && file.size > 10 * 1024 * 1024) {
      setError('Resume file size must not exceed 10 MB.');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // 1. Create candidate
      const candidateData = {
        full_name: formData.fullName,
        email: formData.email,
        phone: formData.phone,
        target_role: formData.targetRole
      };

      const res = await api.post('/candidates', candidateData);
      const candidateId = res.data.id;

      // 2. Upload resume if provided
      if (file) {
        const uploadData = new FormData();
        uploadData.append('file', file);
        
        await api.post(`/candidates/${candidateId}/resume`, uploadData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        });
      }

      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'An error occurred while adding the candidate.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="modal-content" style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '24px', width: '90%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserPlus size={24} /> Add Candidate
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }} type="button">
            <X size={24} />
          </button>
        </div>

        {error && <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '0.875rem' }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Full Name *</label>
            <input 
              type="text" 
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Email *</label>
            <input 
              type="email" 
              name="email"
              value={formData.email}
              onChange={handleChange}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Phone Number *</label>
            <input 
              type="tel" 
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Target Role *</label>
            <select 
              name="targetRole"
              value={formData.targetRole}
              onChange={handleChange}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
              required
            >
              <option value="ML Engineer">ML Engineer</option>
              <option value="Frontend Developer">Frontend Developer</option>
              <option value="Backend Developer">Backend Developer</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Resume</label>
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.doc,.docx"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '4px' }}>
              Supported: PDF, DOC, DOCX | Max 10 MB
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
            <button 
              type="button" 
              onClick={onClose} 
              disabled={loading}
              style={{ padding: '8px 16px', backgroundColor: '#e5e7eb', color: '#374151', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={loading}
              style={{ padding: '8px 16px', backgroundColor: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 500 }}
            >
              {loading ? 'Adding...' : 'Add Candidate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddCandidateModal;
