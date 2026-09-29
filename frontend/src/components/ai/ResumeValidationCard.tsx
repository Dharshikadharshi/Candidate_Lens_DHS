import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSearch } from 'lucide-react';

interface ResumeValidationCardProps {
  candidateId: string;
}

const ResumeValidationCard: React.FC<ResumeValidationCardProps> = ({ candidateId }) => {
  const navigate = useNavigate();

  return (
    <section className="card" aria-label="Resume validation">
      <div className="section-header">
        <h2 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          Resume Validation
          <span className="status-badge status-primary" style={{ fontSize: '0.7rem', padding: '2px 6px' }}>New</span>
        </h2>
        <button 
          className="btn-primary-sm" 
          onClick={() => navigate(`/candidates/${candidateId}/resume-validation`)}
        >
          <FileSearch size={16} /> Validate Resume
        </button>
      </div>
      <div className="hint" style={{ marginTop: '8px' }}>
        Validate resume completeness, role relevance, evidence and document quality.
      </div>
    </section>
  );
};

export default ResumeValidationCard;
