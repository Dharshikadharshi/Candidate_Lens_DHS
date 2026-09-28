import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

interface AnswerRecorderProps {
  // The microphone track already published to LiveKit. Reused so we don't open a second mic stream;
  // the browser microphone is only requested as a fallback when that track is unavailable.
  micTrack?: MediaStreamTrack;
  micMuted: boolean;
  maxSeconds: number;
  disabled?: boolean;
  // Hands-free: start listening as soon as the question is shown.
  autoStart?: boolean;
  onRecorded: (audio: Blob, durationSeconds: number) => void;
  onListeningChange?: (listening: boolean) => void;
}

// Voice activity detection: stop automatically after this much silence once speech was heard.
const SPEECH_LEVEL = 0.02;
const SILENCE_STOP_MS = 3500;
const MIN_ANSWER_MS = 3000;
const NO_SPEECH_HINT_MS = 15000;

const pickMimeType = () => {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return options.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) || '';
};

interface RecordingSession {
  rec: MediaRecorder;
  analyser: AnalyserNode | null;
  ctx: AudioContext | null;
  ownedStream: MediaStream | null;  // only set when we had to open the mic ourselves
  discarded: boolean;
}

const AnswerRecorder: React.FC<AnswerRecorderProps> = ({
  micTrack, micMuted, maxSeconds, disabled, autoStart, onRecorded, onListeningChange,
}) => {
  const session = useRef<RecordingSession | null>(null);
  const startedAt = useRef(0);
  const heardSpeech = useRef(false);
  const lastVoiceAt = useRef(0);
  const autoStarted = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');

  const release = (s: RecordingSession) => {
    s.ctx?.close().catch(() => undefined);
    s.ownedStream?.getTracks().forEach((t) => t.stop());  // never stops LiveKit's own track
  };

  const stop = () => {
    if (session.current?.rec.state === 'recording') session.current.rec.stop();
  };

  const start = async () => {
    if (session.current?.rec.state === 'recording') return;
    setError('');
    setHint('');
    if (micMuted) {
      setError('Your microphone is muted. Unmute it to answer.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record audio. Please type your answer.');
      return;
    }
    let ownedStream: MediaStream | null = null;
    try {
      let track = micTrack && micTrack.readyState === 'live' ? micTrack : undefined;
      if (!track) {
        ownedStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        track = ownedStream.getAudioTracks()[0];
      }
      const stream = new MediaStream([track]);
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      let ctx: AudioContext | null = null;
      let analyser: AnalyserNode | null = null;
      try {
        ctx = new AudioContext();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
      } catch {
        ctx = null;
        analyser = null;  // no pause detection: the candidate uses "Finish answer"
      }
      const current: RecordingSession = { rec, analyser, ctx, ownedStream, discarded: false };
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        release(current);
        // A discarded or superseded session (e.g. React remount) cleans up silently.
        if (current.discarded || session.current !== current) return;
        session.current = null;
        const duration = (Date.now() - startedAt.current) / 1000;
        setRecording(false);
        setLevel(0);
        onListeningChange?.(false);
        if (!heardSpeech.current) {
          setError("We didn't hear anything. Check your microphone and press Start answering, or type your answer.");
          return;  // don't send silence for transcription
        }
        onRecorded(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), duration);
      };
      rec.onerror = () => {
        release(current);
        if (session.current !== current) return;
        session.current = null;
        setRecording(false);
        onListeningChange?.(false);
        setError('Recording stopped unexpectedly. Please try again or type your answer.');
      };
      session.current = current;
      heardSpeech.current = false;
      startedAt.current = Date.now();
      lastVoiceAt.current = Date.now();
      setElapsed(0);
      rec.start(1000);
      setRecording(true);
      onListeningChange?.(true);
    } catch {
      ownedStream?.getTracks().forEach((t) => t.stop());
      setError('Could not access your microphone. Allow microphone access or type your answer.');
    }
  };

  // Timer, level meter and automatic stop on a pause.
  useEffect(() => {
    if (!recording) return;
    const analyser = session.current?.analyser ?? null;
    const buffer = analyser ? new Float32Array(analyser.fftSize) : null;
    const t = window.setInterval(() => {
      const now = Date.now();
      const ms = now - startedAt.current;
      setElapsed(ms / 1000);
      if (analyser && buffer) {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const v of buffer) sum += v * v;
        const rms = Math.sqrt(sum / buffer.length);
        setLevel(Math.min(1, rms * 8));
        if (rms > SPEECH_LEVEL) {
          heardSpeech.current = true;
          lastVoiceAt.current = now;
          setHint('');
        } else if (heardSpeech.current && ms > MIN_ANSWER_MS && now - lastVoiceAt.current > SILENCE_STOP_MS) {
          stop();
        } else if (!heardSpeech.current && ms > NO_SPEECH_HINT_MS) {
          setHint("We can't hear you yet. Check that your microphone is on and unmuted.");
        }
      } else {
        heardSpeech.current = true;  // cannot measure: trust the candidate's "Finish answer"
      }
      if (ms / 1000 >= maxSeconds) stop();
    }, 100);
    return () => window.clearInterval(t);
  }, [recording, maxSeconds]);

  useEffect(() => {
    if (autoStart && !disabled && !micMuted && !autoStarted.current) {
      autoStarted.current = true;
      start();
    }
  }, [autoStart, disabled, micMuted]);

  // Stop if answering becomes disallowed mid-recording (camera off, interviewer away).
  useEffect(() => { if (disabled && recording) stop(); }, [disabled]);

  // Unmount (including React StrictMode's dev-only remount): discard the recording quietly
  // and re-arm auto-start so a remounted recorder starts listening again.
  useEffect(() => () => {
    const current = session.current;
    autoStarted.current = false;
    if (current) {
      current.discarded = true;
      session.current = null;
      if (current.rec.state === 'recording') current.rec.stop();
      else release(current);
    }
  }, []);

  const mm = Math.floor(elapsed / 60);
  const ss = Math.floor(elapsed % 60).toString().padStart(2, '0');

  return (
    <div className="recorder">
      {recording ? (
        <>
          <div className="recorder-live" role="status"><span className="live-dot" /> Listening… {mm}:{ss}</div>
          <div className="level-meter" aria-hidden><div style={{ width: `${Math.round(level * 100)}%` }} /></div>
          <div className="hint">Answer out loud. We'll move on when you pause, or press Finish answer.</div>
          {hint && <div className="notice notice-warn">{hint}</div>}
          <button className="btn-danger-sm" onClick={stop}><Square size={16} /> Finish answer</button>
        </>
      ) : (
        <button className="btn-primary-sm" onClick={start} disabled={disabled}><Mic size={16} /> Start answering</button>
      )}
      {error && <div className="error-message" role="alert" style={{ textAlign: 'left' }}>{error}</div>}
    </div>
  );
};

export default AnswerRecorder;
