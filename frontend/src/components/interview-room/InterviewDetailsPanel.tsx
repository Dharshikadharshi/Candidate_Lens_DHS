import React from 'react';
import InterviewStatusBadge from '../InterviewStatusBadge';
import type { Interview } from '../../types/interview';
import { formatDateTime } from '../../utils/datetime';

export type NotesSaveState = 'idle' | 'saving' | 'saved' | 'error';

interface InterviewDetailsPanelProps {
  interview: Interview;
  statusPending?: boolean;
  // Interviewer-only
  notes?: string;
  notesState?: NotesSaveState;
  onNotesChange?: (value: string) => void;
  onNotesBlur?: () => void;
}

const NOTES_LABEL: Record<NotesSaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved — will retry on next change',
};

// Rendered inside the room's right panel (which also hosts the AI interviewer).
const InterviewDetailsPanel: React.FC<InterviewDetailsPanelProps> = ({
  interview, statusPending, notes, notesState = 'idle', onNotesChange, onNotesBlur,
}) => (
  <>
    {interview.is_interviewer && onNotesChange && (
      <div className="room-panel-section">
        <div className="room-section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <label htmlFor="interview-notes">Interviewer notes</label>
          <span className={`hint ${notesState === 'error' ? 'text-error' : ''}`} aria-live="polite">{NOTES_LABEL[notesState]}</span>
        </div>
        <textarea
          id="interview-notes"
          className="form-input notes-input"
          placeholder="Private notes — only you can see these. Kept separate from AI findings."
          value={notes}
          maxLength={20000}
          onChange={(e) => onNotesChange(e.target.value)}
          onBlur={onNotesBlur}
        />
      </div>
    )}

    <div className="room-panel-section">
      <div className="room-section-title">Interview</div>
      <dl className="detail-list compact">
        <div><dt>Role</dt><dd>{interview.target_role}</dd></div>
        <div><dt>Candidate</dt><dd>{interview.candidate_name}</dd></div>
        <div><dt>Interviewer</dt><dd>{interview.interviewer_name || '—'}</dd></div>
        <div><dt>Scheduled</dt><dd>{formatDateTime(interview.scheduled_at)}</dd></div>
        <div><dt>Duration</dt><dd>{interview.duration_minutes} min</dd></div>
        <div><dt>Session</dt><dd><InterviewStatusBadge status={interview.display_status} pending={statusPending} /></dd></div>
        {interview.started_at && <div><dt>Started</dt><dd>{formatDateTime(interview.started_at)}</dd></div>}
        {interview.ended_at && <div><dt>Ended</dt><dd>{formatDateTime(interview.ended_at)}</dd></div>}
      </dl>
    </div>
  </>
);

export default InterviewDetailsPanel;
