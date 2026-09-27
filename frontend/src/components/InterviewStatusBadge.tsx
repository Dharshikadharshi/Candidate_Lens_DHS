import React from 'react';
import type { InterviewDisplayStatus } from '../types/interview';

const LABELS: Record<InterviewDisplayStatus | 'not_scheduled', { label: string; className: string }> = {
  not_scheduled: { label: 'Not scheduled', className: 'status-neutral' },
  request_pending: { label: 'Request pending', className: 'status-awaiting' },
  accepted: { label: 'Accepted', className: 'status-completed' },
  scheduled: { label: 'Scheduled', className: 'status-in-progress' },
  ready: { label: 'Ready to join', className: 'status-ready' },
  declined: { label: 'Declined', className: 'status-danger' },
  in_progress: { label: 'In progress', className: 'status-live' },
  completed: { label: 'Completed', className: 'status-completed' },
  cancelled: { label: 'Cancelled', className: 'status-neutral' },
  expired: { label: 'Expired', className: 'status-neutral' },
  failed: { label: 'Failed', className: 'status-danger' },
};

interface InterviewStatusBadgeProps {
  status: InterviewDisplayStatus | 'not_scheduled';
  pending?: boolean;
}

const InterviewStatusBadge: React.FC<InterviewStatusBadgeProps> = ({ status, pending }) => {
  const { label, className } = LABELS[status] || { label: status, className: 'status-neutral' };
  return (
    <span className={`status-badge ${className}`} style={pending ? { opacity: 0.7 } : undefined} title={pending ? 'Saving…' : undefined}>
      {status === 'in_progress' && <span className="live-dot" aria-hidden />}
      {label}{pending ? '…' : ''}
    </span>
  );
};

export default InterviewStatusBadge;
