import React from 'react';
import { LogOut, Mic, MicOff, PhoneOff, Play, Video, VideoOff } from 'lucide-react';

interface VideoCallControlsProps {
  micOn: boolean;
  cameraOn: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
  // Interviewer-only session controls
  canStart?: boolean;
  canEnd?: boolean;
  busy?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
}

const VideoCallControls: React.FC<VideoCallControlsProps> = ({
  micOn, cameraOn, onToggleMic, onToggleCamera, onLeave, canStart, canEnd, busy, onStart, onEnd,
}) => (
  <div className="call-controls" role="toolbar" aria-label="Call controls">
    <button className={`control-btn ${micOn ? '' : 'control-off'}`} onClick={onToggleMic} aria-pressed={micOn} title={micOn ? 'Mute microphone' : 'Unmute microphone'}>
      {micOn ? <Mic size={18} /> : <MicOff size={18} />}
      <span>{micOn ? 'Mute' : 'Unmute'}</span>
    </button>
    <button className={`control-btn ${cameraOn ? '' : 'control-off'}`} onClick={onToggleCamera} aria-pressed={cameraOn} title={cameraOn ? 'Turn camera off' : 'Turn camera on'}>
      {cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
      <span>{cameraOn ? 'Stop video' : 'Start video'}</span>
    </button>
    {canStart && onStart && (
      <button className="control-btn control-primary" onClick={onStart} disabled={busy}>
        <Play size={18} /><span>Start interview</span>
      </button>
    )}
    <button className="control-btn" onClick={onLeave} title="Leave the room. You can rejoin while the interview is open.">
      <LogOut size={18} /><span>Leave</span>
    </button>
    {canEnd && onEnd && (
      <button className="control-btn control-danger" onClick={onEnd} disabled={busy}>
        <PhoneOff size={18} /><span>End interview</span>
      </button>
    )}
  </div>
);

export default VideoCallControls;
