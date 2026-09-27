import React from 'react';
import { Download, FileText } from 'lucide-react';
import type { CandidateDetail } from '../../types/interview';
import type { SourceClaim } from '../../types/ai';

interface ResumePanelProps {
  candidate: CandidateDetail | null;
  resumeUrl: string | null;
  loading: boolean;
  error: string;
  // From the AI resume analysis.
  skills?: string[];
  projects?: { name: string; summary?: string }[];
  analysisStatus?: string;
  // Resume claim behind the question currently being asked.
  focus?: SourceClaim | null;
}

const ResumePanel: React.FC<ResumePanelProps> = ({ candidate, resumeUrl, loading, error, skills, projects, analysisStatus, focus }) => {
  const resume = candidate?.resume;
  const isPdf = resume?.file_type === 'application/pdf';

  return (
    <aside className="room-panel room-panel-left" aria-label="Candidate resume">
      <div className="room-panel-header">
        <div className="room-panel-title">{candidate?.full_name || 'Candidate'}</div>
        <div className="room-panel-subtitle">{candidate?.target_role}</div>
      </div>

      {focus && (
        <div className="room-panel-section resume-focus" aria-live="polite">
          <div className="room-section-title">Relevant to the current question</div>
          <div><strong>{focus.claim}</strong></div>
          {focus.source_text && (
            <div className="evidence-quote">“{focus.source_text}”{focus.section ? ` — ${focus.section}` : ''}{focus.page ? `, page ${focus.page}` : ''}</div>
          )}
        </div>
      )}

      <div className="room-panel-section">
        <div className="room-section-title">Skills</div>
        {skills && skills.length > 0 ? (
          <div className="chip-row">{skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>
        ) : (
          <div className="hint">{analysisStatus === 'processing' ? 'Analyzing resume…' : 'Not extracted yet. Run the AI resume analysis from the candidate profile.'}</div>
        )}
      </div>

      <div className="room-panel-section">
        <div className="room-section-title">Projects</div>
        {projects && projects.length > 0 ? (
          <ul className="plain-list">{projects.map((p) => <li key={p.name}><strong>{p.name}</strong>{p.summary ? ` — ${p.summary}` : ''}</li>)}</ul>
        ) : (
          <div className="hint">Not extracted yet.</div>
        )}
      </div>

      <div className="room-panel-section room-resume">
        <div className="room-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span><FileText size={14} style={{ verticalAlign: 'middle' }} /> Resume</span>
          {resumeUrl && resume && (
            <a href={resumeUrl} download={resume.original_filename} className="action-link" style={{ fontSize: '0.75rem' }}>
              <Download size={12} /> Download
            </a>
          )}
        </div>
        {!resume ? (
          <div className="hint">No resume uploaded.</div>
        ) : loading ? (
          <div className="hint">Loading resume…</div>
        ) : error ? (
          <div className="error-message" style={{ textAlign: 'left' }}>{error}</div>
        ) : resumeUrl && isPdf ? (
          <iframe src={resumeUrl} title={`${candidate?.full_name} resume`} className="resume-frame" />
        ) : (
          <div className="hint">{resume.original_filename} can't be previewed in the browser. Use Download to open it.</div>
        )}
      </div>
    </aside>
  );
};

export default ResumePanel;
