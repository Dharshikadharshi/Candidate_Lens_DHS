import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ConnectionState,
  DisconnectReason,
  MediaDeviceFailure,
  Room,
  RoomEvent,
  type RemoteParticipant,
} from 'livekit-client';
import type { JoinRoomResponse } from '../types/interview';

// Every phase below is driven by events from the LiveKit SDK, never assumed by the UI.
export type CallPhase = 'idle' | 'requesting' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export type DeviceKind = 'camera' | 'microphone';

export interface MediaIssue {
  kind: DeviceKind;
  message: string;
}

const deviceMessage = (kind: DeviceKind, error: unknown) => {
  const noun = kind === 'camera' ? 'camera' : 'microphone';
  switch (MediaDeviceFailure.getFailure(error)) {
    case MediaDeviceFailure.PermissionDenied:
      return `Access to your ${noun} was blocked. Allow it in your browser's site settings, then turn it on again.`;
    case MediaDeviceFailure.NotFound:
      return `No ${noun} was found. Connect one and try again.`;
    case MediaDeviceFailure.DeviceInUse:
      return `Your ${noun} is being used by another application.`;
    default:
      return `Could not start your ${noun}.`;
  }
};

const disconnectMessage = (reason?: DisconnectReason) => {
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
      return 'You left the interview.';
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return 'The interview room was closed.';
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'You joined this interview from another tab or device.';
    case DisconnectReason.PARTICIPANT_REMOVED:
      return 'You were removed from the interview room.';
    case DisconnectReason.SERVER_SHUTDOWN:
      return 'The video server restarted. Please rejoin.';
    default:
      return 'The connection was lost. You can rejoin while the interview is open.';
  }
};

export function useLiveKitRoom() {
  const roomRef = useRef<Room | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [error, setError] = useState('');
  const [endedMessage, setEndedMessage] = useState('');
  const [mediaIssues, setMediaIssues] = useState<MediaIssue[]>([]);
  const [canPlayAudio, setCanPlayAudio] = useState(true);
  const [remoteHasLeft, setRemoteHasLeft] = useState(false);
  // Participant/track state lives on the Room object; re-render when it changes.
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  const setIssue = (kind: DeviceKind, message: string | null) =>
    setMediaIssues((prev) => [...prev.filter((i) => i.kind !== kind), ...(message ? [{ kind, message }] : [])]);

  const setDevice = useCallback(async (kind: DeviceKind, enabled: boolean) => {
    const room = roomRef.current;
    if (!room) return;
    try {
      if (kind === 'camera') await room.localParticipant.setCameraEnabled(enabled);
      else await room.localParticipant.setMicrophoneEnabled(enabled);
      setIssue(kind, null);
    } catch (err) {
      setIssue(kind, deviceMessage(kind, err));
    } finally {
      forceRender();
    }
  }, []);

  const connect = useCallback(async (requestAccess: () => Promise<JoinRoomResponse>) => {
    if (roomRef.current && roomRef.current.state !== ConnectionState.Disconnected) return null;
    setError('');
    setEndedMessage('');
    setRemoteHasLeft(false);
    setPhase('requesting');

    let access: JoinRoomResponse;
    try {
      access = await requestAccess();
    } catch (err: any) {
      setPhase('error');
      setError(err?.response?.data?.detail || 'Could not get access to the interview room.');
      return null;
    }

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    setRoom(room);

    room
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (state === ConnectionState.Connected) setPhase('connected');
        else if (state === ConnectionState.Connecting) setPhase('connecting');
        else if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) setPhase('reconnecting');
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        setPhase('disconnected');
        setEndedMessage(disconnectMessage(reason));
        forceRender();
      })
      .on(RoomEvent.ParticipantConnected, () => { setRemoteHasLeft(false); forceRender(); })
      .on(RoomEvent.ParticipantDisconnected, (_p: RemoteParticipant) => { setRemoteHasLeft(true); forceRender(); })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setCanPlayAudio(room.canPlaybackAudio))
      .on(RoomEvent.MediaDevicesError, (err: Error) => setIssue('camera', deviceMessage('camera', err)))
      .on(RoomEvent.TrackSubscribed, forceRender)
      .on(RoomEvent.TrackUnsubscribed, forceRender)
      .on(RoomEvent.TrackMuted, forceRender)
      .on(RoomEvent.TrackUnmuted, forceRender)
      .on(RoomEvent.LocalTrackPublished, forceRender)
      .on(RoomEvent.LocalTrackUnpublished, forceRender)
      .on(RoomEvent.ConnectionQualityChanged, forceRender)
      .on(RoomEvent.ActiveSpeakersChanged, forceRender);

    setPhase('connecting');
    try {
      await room.connect(access.server_url, access.token);
    } catch (err) {
      console.error('LiveKit connect failed', err);
      roomRef.current = null;
      setRoom(null);
      setPhase('error');
      setError('Could not connect to the video server. Check your network and try again.');
      return null;
    }

    setCanPlayAudio(room.canPlaybackAudio);
    // Devices are enabled independently so a missing camera does not block audio.
    await setDevice('camera', true);
    await setDevice('microphone', true);
    return access;
  }, [setDevice]);

  const disconnect = useCallback(async () => {
    await roomRef.current?.disconnect();
  }, []);

  const startAudio = useCallback(async () => {
    await roomRef.current?.startAudio();
    setCanPlayAudio(roomRef.current?.canPlaybackAudio ?? true);
  }, []);

  useEffect(() => () => { roomRef.current?.disconnect(); }, []);

  const connected = phase === 'connected' || phase === 'reconnecting';
  return {
    phase,
    error,
    endedMessage,
    mediaIssues,
    canPlayAudio,
    remoteHasLeft,
    localParticipant: connected ? room?.localParticipant : undefined,
    remoteParticipants: connected && room ? Array.from(room.remoteParticipants.values()) : [],
    connect,
    disconnect,
    setDevice,
    startAudio,
  };
}
