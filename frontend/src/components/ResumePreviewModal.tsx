import React from 'react';
import { X, Download } from 'lucide-react';

interface ResumePreviewModalProps {
  url: string;
  candidate: any;
  onClose: () => void;
  onDownload: () => void;
}

const ResumePreviewModal: React.FC<ResumePreviewModalProps> = ({ url, candidate, onClose, onDownload }) => {
  return (
    <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div className="modal-content" style={{ backgroundColor: '#fff', borderRadius: '8px', width: '90%', maxWidth: '1000px', height: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #eee' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{candidate.full_name} - Resume</h2>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#666' }}>{candidate.resume?.original_filename}</p>
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <button 
              onClick={onDownload} 
              className="btn-primary" 
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', backgroundColor: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              <Download size={16} /> Download
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
              <X size={24} />
            </button>
          </div>
        </div>
        
        <div style={{ flex: 1, backgroundColor: '#f0f0f0', overflow: 'hidden' }}>
          <iframe 
            src={url} 
            title="Resume Preview" 
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        </div>
      </div>
    </div>
  );
};

export default ResumePreviewModal;
