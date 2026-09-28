import React, { useEffect, useRef } from 'react';
import { ConnectionQuality, Track, type Participant } from 'livekit-client';
import { MicOff, VideoOff, WifiOff } from 'lucide-react';

interface VideoTileProps {
  participant?: Participant;
  label: string;
  isLocal?: boolean;
  placeholder: string;
  compact?: boolean;
}

const VideoTile: React.FC<VideoTileProps> = ({ participant, label, isLocal, placeholder, compact }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const cameraPub = participant?.getTrackPublication(Track.Source.Camera);
  const videoTrack = cameraPub && !cameraPub.isMuted ? cameraPub.track : undefined;
  const micPub = participant?.getTrackPublication(Track.Source.Microphone);
  const audioTrack = !isLocal ? micPub?.track : undefined;
  const micOn = !!micPub && !micPub.isMuted;
  const lost = participant?.connectionQuality === ConnectionQuality.Lost;

  useEffect(() => {
    const el = videoRef.current;
    if (!videoTrack || !el) return;
    videoTrack.attach(el);
    return () => { videoTrack.detach(el); };
  }, [videoTrack]);

  useEffect(() => {
    const el = audioRef.current;
    if (!audioTrack || !el) return;
    audioTrack.attach(el);
    return () => { audioTrack.detach(el); };
  }, [audioTrack]);

  return (
    <div className={`video-tile ${compact ? 'video-tile-compact' : ''} ${participant?.isSpeaking ? 'video-tile-speaking' : ''}`}>
      {videoTrack ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} className={isLocal ? 'mirrored' : undefined} />
      ) : (
        <div className="video-placeholder">
          {participant ? (
            <>
              <div className="avatar avatar-lg" aria-hidden>{label.charAt(0).toUpperCase()}</div>
              <span><VideoOff size={14} /> Camera off</span>
            </>
          ) : (
            <span>{placeholder}</span>
          )}
        </div>
      )}
      {audioTrack && <audio ref={audioRef} autoPlay />}
      {participant && (
        <div className="video-label">
          {!micOn && <MicOff size={12} aria-label="Microphone off" />}
          {lost && <WifiOff size={12} aria-label="Connection unstable" />}
          <span>{label}{isLocal ? ' (you)' : ''}</span>
        </div>
      )}
    </div>
  );
};

export default VideoTile;
