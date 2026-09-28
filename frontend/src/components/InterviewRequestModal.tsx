import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { InterviewCreatePayload } from '../types/interview';
import { localTimeZoneLabel } from '../utils/datetime';

interface InterviewRequestModalProps {
  candidateName: string;
  onClose: () => void;
  onSubmit: (payload: InterviewCreatePayload) => void;
}

const pad = (n: number) => n.toString().padStart(2, '0');

const defaultSlot = () => {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  d.setHours(Math.max(9, Math.min(d.getHours(), 17)));
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:00`,
  };
};

const DURATIONS = [15, 30, 45, 60, 90];

const InterviewRequestModal: React.FC<InterviewRequestModalProps> = ({ candidateName, onClose, onSubmit }) => {
  const initial = defaultSlot();
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(30);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time) {
      setError('Please choose a date and start time.');
      return;
    }
    // Interpreted in the HR user's local time zone, sent as an absolute UTC instant.
    const scheduled = new Date(`${date}T${time}`);
    if (Number.isNaN(scheduled.getTime())) {
      setError('Please enter a valid date and time.');
      return;
    }
    if (scheduled.getTime() < Date.now()) {
      setError('Interview time must be in the future.');
      return;
    }
    if (message.length > 2000) {
      setError('Message must be 2000 characters or fewer.');
      return;
    }
    onSubmit({
      scheduled_at: scheduled.toISOString(),
      duration_minutes: duration,
      message: message.trim() || undefined,
    });
  };

  return (
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="modal-content" role="dialog" aria-labelledby="request-interview-title" style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '24px', width: '90%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h2 id="request-interview-title" style={{ margin: 0, fontSize: '1.25rem' }}>Request Interview</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={22} />
          </button>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '20px' }}>
          Invite <strong>{candidateName}</strong> to a live video interview on CandidateLens.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label" htmlFor="interview-date">Date</label>
              <input id="interview-date" type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label" htmlFor="interview-time">Start time</label>
              <input id="interview-time" type="time" className="form-input" value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-0.5rem', marginBottom: '1rem' }}>
            Times are in your time zone ({localTimeZoneLabel()}). The candidate sees them in theirs.
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label" htmlFor="interview-duration">Duration</label>
            <select id="interview-duration" className="form-input" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label" htmlFor="interview-message">Message to candidate (optional)</label>
            <textarea
              id="interview-message"
              className="form-input"
              rows={4}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Please join us for your technical interview."
              style={{ resize: 'vertical' }}
            />
          </div>

          {error && <div className="error-message" role="alert">{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button type="button" onClick={onClose} className="btn-secondary-sm">Cancel</button>
            <button type="submit" className="btn-primary-sm">Send request</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InterviewRequestModal;
