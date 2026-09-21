// Realtime voice session hook for the browser client.
//
// Owns the WebRTC room lifecycle: token fetch, connect, mic, the chunked
// session.init handshake with the agent worker, agent-state mapping,
// transcript/attachment data channels, transport reconnect (including a
// stale-room watchdog for silent transport death), and disconnect.
//
// Framework: React hook, but the only React usage is state — every
// interaction surface is a plain callback so a non-React host can wrap it.
// Browser-only by design: no Electron IPC, no Node APIs, no local paths.
import { useRef, useEffect, useCallback, useState } from 'react';
import { ConnectionState, ParticipantKind, Room, RoomEvent, Track } from 'livekit-client';
import {
  buildRealtimeSessionInit,
  chunkSessionInitPayload,
  type RealtimeSessionInitPayload,
} from './sessionInit.ts';
import {
  IMAGE_STREAM_TOPIC,
  SESSION_EVENT_TOPIC,
  SESSION_INIT_TOPIC,
  type AttachmentChannelMessage,
  type SessionEndMessage,
} from '../core/attachmentProtocol.ts';

// ── Types ──────────────────────────────────────────────────────────────────
export type RealtimePhase =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'ready' }
  | { phase: 'listening' | 'thinking' | 'speaking' | 'interrupted' }
  | { phase: 'error'; message: string; fatal: boolean };

export type RealtimeSessionConfig = {
  /** Master switch: hook does nothing when false. */
  enabled: boolean;
  /** When true (and enabled) the hook connects to the room. */
  active: boolean;
  /** Room name (unique per call session). */
  roomName: string;
  /** Authenticated host callback returning a short-lived room token. */
  getToken: () => Promise<{ token: string; livekitUrl: string; room?: string; identity?: string }>;
  /**
   * Builds the validated session init payload (instructions, greeting,
   * providers, conversation history). Called once per connect attempt; throw
   * (or reject) to surface a fatal configuration error. Async is allowed so
   * hosts can load history/config before connecting.
   */
  buildSessionInitPayload: () => RealtimeSessionInitPayload | Promise<RealtimeSessionInitPayload>;
  /** Called when a final user transcript arrives. */
  onUserFinal: (text: string) => void;
  /** Called when an assistant conversation item arrives. */
  onAgentItem: (text: string, interrupted: boolean) => void;
  /** Called when a barge-in truncated assistant audio (stopDelayMs measured). */
  onInterruptConfirmed?: (stopDelayMs: number) => void;
  /**
   * Attachment protocol (topic "rt.attachment") worker → client messages
   * (read requests, vision-unsupported reports). Optional: hosts without
   * attachments see no behavior change.
   */
  onAttachmentChannelMessage?: (message: AttachmentChannelMessage) => void;
  /** Called when a fatal error occurs (e.g. worker provider init fails). */
  onFatalError: (message: string) => void;
  /**
   * Read-only observation hook: reports the current remote-audio <audio>
   * element (null when none). The hook keeps full ownership of playback;
   * observers must not mutate the element.
   */
  onRemoteAudioElement?: (element: HTMLAudioElement | null) => void;
};

function describeRealtimeMediaError(action: string, error: unknown) {
  const candidate = error as { name?: unknown; message?: unknown } | null;
  const name = typeof candidate?.name === 'string' ? candidate.name.slice(0, 80) : 'Error';
  const message = typeof candidate?.message === 'string' ? candidate.message.slice(0, 240) : '';
  return `${action}: ${name}${message ? ` (${message})` : ''}`;
}

function detachRealtimeAudio(track: Track | null, element: HTMLAudioElement | null) {
  if (track && element) {
    try { track.detach(element); } catch { /* ignore an already-detached track */ }
  }
  if (element) {
    element.pause();
    element.srcObject = null;
    element.remove();
  }
}

function createRealtimeAudioElement() {
  const element = document.createElement('audio');
  element.autoplay = true;
  element.muted = false;
  element.volume = 1;
  element.dataset.realtimeAddonAudio = 'remote';
  element.style.display = 'none';
  document.body.appendChild(element);
  return element;
}

type SinkAudioElement = HTMLAudioElement & {
  sinkId?: string;
  setSinkId?: (sinkId: string) => Promise<void>;
};

// Chromium can keep a stale non-default output sink on a reused media element;
// return to the system default so remote TTS is never silently mis-routed.
async function ensureDefaultAudioSink(element: HTMLAudioElement) {
  const sinkElement = element as SinkAudioElement;
  if (typeof sinkElement.setSinkId === 'function' && sinkElement.sinkId && sinkElement.sinkId !== 'default') {
    await sinkElement.setSinkId?.('default');
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useRealtimeCallSession(config: RealtimeSessionConfig) {
  const roomRef = useRef<Room | null>(null);
  const [phase, setPhase] = useState<RealtimePhase>({ phase: 'idle' });
  const [micEnabled, setMicEnabledState] = useState(false);

  // Refs that hold the latest config values so event handlers don't stale.
  const configRef = useRef(config);
  configRef.current = config;

  const interruptedUntilRef = useRef(0);
  const readyRef = useRef(false);
  const agentRef = useRef<string | null>(null);
  const handshakeReceivedRef = useRef(false);
  const workerErrorRef = useRef<string | null>(null);
  // Resilience state: intentional-stop flag so hangup never triggers the
  // auto-reconnect path, plus a handle for any pending scheduled reconnect.
  const stoppingRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReconnectRef = useRef<(() => void) | null>(null);
  const remoteAudioTrackRef = useRef<Track | null>(null);
  const remoteAudioElementRef = useRef<HTMLAudioElement | null>(null);
  // Stale-room watchdog: the renderer can lose the SFU (room deleted
  // server-side, zero sockets) without any Disconnected delivery, leaving a
  // fake "listening" forever. A low-frequency client-side check of the public
  // Room state is the only cross-runtime detection layer.
  const staleRoomWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStaleRoomWatchdog = useCallback(() => {
    if (staleRoomWatchdogRef.current) {
      clearInterval(staleRoomWatchdogRef.current);
      staleRoomWatchdogRef.current = null;
    }
  }, []);

  const updatePhase = useCallback((p: RealtimePhase) => {
    setPhase(p);
  }, []);

  const detachRemoteAudio = useCallback(() => {
    detachRealtimeAudio(remoteAudioTrackRef.current, remoteAudioElementRef.current);
    remoteAudioTrackRef.current = null;
    remoteAudioElementRef.current = null;
    configRef.current.onRemoteAudioElement?.(null);
  }, []);

  // Single teardown + recovery entry for every path that discovers the
  // transport is gone (Disconnected event, stale-room watchdog). Call sites
  // guard on room identity, so one transport failure schedules at most one
  // app-level reconnect and the watchdog + LiveKit's own resume can never
  // race each other into competing rooms.
  const handleTransportDown = useCallback((room: Room, reason: string) => {
    stopStaleRoomWatchdog();
    detachRemoteAudio();
    const wasLive = readyRef.current;
    roomRef.current = null;
    readyRef.current = false;
    handshakeReceivedRef.current = false;
    // The watchdog can catch the room mid-resume; disconnect it so LiveKit's
    // own reconnection cannot finish in the background and race the app-level
    // reconnect with a zombie session.
    try {
      if (room.state !== ConnectionState.Disconnected) room.disconnect();
    } catch { /* already down */ }
    if (stoppingRef.current) {
      updatePhase({ phase: 'idle' });
      return;
    }
    if (!wasLive) {
      updatePhase({ phase: 'error', message: '连接已断开', fatal: false });
      return;
    }
    console.warn(`[realtime] transport down (${reason}); scheduling one auto-reconnect`);
    // An unexpected drop of a live session auto-reconnects once via the
    // existing scheduler; a second failure stays a recoverable error for
    // manual retry.
    updatePhase({ phase: 'error', message: '连接中断，正在重连…', fatal: false });
    scheduleReconnectRef.current?.();
  }, [detachRemoteAudio, stopStaleRoomWatchdog, updatePhase]);

  // Low-frequency backstop (15s) for the silent-death case where no event
  // fires: the session is still marked live but the public Room state is no
  // longer connected. Client-only on purpose. LiveKit's internal resume gets
  // one bounded grace window before the app-level reconnect takes over, so
  // the two paths never fight over the room.
  const startStaleRoomWatchdog = useCallback((room: Room) => {
    stopStaleRoomWatchdog();
    let degradedSince: number | null = null;
    staleRoomWatchdogRef.current = setInterval(() => {
      if (stoppingRef.current || !readyRef.current || roomRef.current !== room) return;
      const state = room.state;
      if (state === ConnectionState.Connected) {
        degradedSince = null;
        return;
      }
      if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
        if (degradedSince === null) {
          degradedSince = Date.now();
          return;
        }
        if (Date.now() - degradedSince < 20_000) return;
      }
      console.warn(`[realtime] stale room watchdog tripped: room.state=${state}`);
      handleTransportDown(room, `stale-room:${state}`);
    }, 15_000);
  }, [handleTransportDown, stopStaleRoomWatchdog]);

  // ── stop ──────────────────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    stoppingRef.current = true;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    scheduleReconnectRef.current = null;
    stopStaleRoomWatchdog();
    detachRemoteAudio();
    const room = roomRef.current;
    if (!room) return;
    try {
      if (room.state === 'connected') {
        const endMessage: SessionEndMessage = { type: 'session.end' };
        room.localParticipant.publishData(
          new TextEncoder().encode(JSON.stringify(endMessage)),
          { reliable: true, topic: SESSION_INIT_TOPIC }
        );
      }
    } catch { /* ignore */ }
    room.disconnect();
    roomRef.current = null;
    readyRef.current = false;
    handshakeReceivedRef.current = false;
    workerErrorRef.current = null;
    updatePhase({ phase: 'idle' });
  }, [detachRemoteAudio, stopStaleRoomWatchdog, updatePhase]);

  // ── connect ────────────────────────────────────────────────────────────────
  // One connect attempt. Returns true when the session is fully ready.
  // Failures emit their own phase update and return false so the wrapper can
  // decide about a retry without double-reporting.
  const attemptConnect = useCallback(async (): Promise<boolean> => {
    const cfg = configRef.current;
    if (!cfg.enabled || !cfg.active) return false;

    // A previous room can still exist when a reconnect is triggered while
    // LiveKit's own resume had not finished (e.g. manual retry from the error
    // banner). Tear it down first so two rooms can never fight over the mic
    // and the remote-audio element.
    const previousRoom = roomRef.current;
    if (previousRoom) {
      roomRef.current = null;
      readyRef.current = false;
      stopStaleRoomWatchdog();
      try { previousRoom.removeAllListeners(); } catch { /* ignore */ }
      try { if (previousRoom.state !== ConnectionState.Disconnected) previousRoom.disconnect(); } catch { /* ignore */ }
    }

    updatePhase({ phase: 'connecting' });
    workerErrorRef.current = null;
    handshakeReceivedRef.current = false;

    try {
      // 1. Fetch the token contract. The server returns both values needed by
      // the renderer without exposing LiveKit signing credentials.
      let tokenPayload: unknown;
      try {
        tokenPayload = await cfg.getToken();
      } catch (err: any) {
        throw new Error(`token fetch failed: ${String(err?.message || err)}`);
      }
      const { token, livekitUrl } = tokenPayload as { token?: unknown; livekitUrl?: unknown };
      if (typeof token !== 'string' || !token || typeof livekitUrl !== 'string' || !livekitUrl) {
        throw new Error('token fetch failed: invalid realtime token response');
      }

      // 2. create room
      const room = new Room({ adaptiveStream: false, dynacast: false });
      roomRef.current = room;
      let publishInitParts: (() => void) | null = null;

      // 3. register event handlers
      // Always track the latest raw agent state; the interrupted flash is a
      // display-layer override only, so no real state updates are dropped.
      const agentStateRef: { current: string | null } = { current: null };
      const applyAgentStatePhase = () => {
        if (Date.now() < interruptedUntilRef.current) return; // flash active
        const st = agentStateRef.current;
        switch (st) {
          case 'listening': case 'idle': updatePhase({ phase: 'listening' }); break;
          case 'thinking': updatePhase({ phase: 'thinking' }); break;
          case 'speaking': updatePhase({ phase: 'speaking' }); break;
          case 'initializing': updatePhase({ phase: 'connecting' }); break;
          case 'disconnected': case 'failed':
            updatePhase({ phase: 'error', message: `agent ${st}`, fatal: false });
            break;
          default: break;
        }
      };

      room.on(RoomEvent.ParticipantAttributesChanged, (_attrs, participant) => {
        if (!participant || participant.identity === room.localParticipant?.identity) return;
        const st = participant.attributes?.['lk.agent.state'];
        if (!st) return;
        agentStateRef.current = st;
        applyAgentStatePhase();
      });

      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (topic === SESSION_INIT_TOPIC && msg.type === 'session.init.request') {
            publishInitParts?.();
            return;
          }
          if (topic === 'rt.attachment' || topic === 'sully.attachment') {
            // worker → client attachment protocol (read requests /
            // vision-unsupported). Same topic both directions; consume only.
            configRef.current.onAttachmentChannelMessage?.(msg);
            return;
          }
          if (topic === SESSION_EVENT_TOPIC) {
            const live = configRef.current;
            switch (msg.type) {
              case 'session.init.received':
                handshakeReceivedRef.current = true;
                break;
              case 'session.ready':
                readyRef.current = true;
                updatePhase({ phase: 'listening' });
                break;
              case 'user_transcript':
                if (msg.isFinal && msg.text) {
                  live.onUserFinal(msg.text);
                }
                break;
              case 'item_added':
                if (msg.role === 'assistant' && msg.text) {
                  live.onAgentItem(msg.text, !!msg.interrupted);
                }
                break;
              case 'user_barge_in':
                // Start the display flash; authoritative recovery comes from
                // interrupt_confirmed (old audio actually stopped) below.
                interruptedUntilRef.current = Date.now() + 4000;
                updatePhase({ phase: 'interrupted' });
                break;
              case 'interrupt_confirmed': {
                // The framework truncated the assistant audio — end the flash
                // now and follow the live agent state (usually thinking).
                interruptedUntilRef.current = 0;
                if (typeof msg.stopDelayMs === 'number') {
                  live.onInterruptConfirmed?.(msg.stopDelayMs);
                }
                applyAgentStatePhase();
                break;
              }
              case 'worker_error':
                {
                  const message = `worker_error/provider init failed: ${String(msg.message || 'unknown worker error')}`;
                  workerErrorRef.current = message;
                  updatePhase({ phase: 'error', message, fatal: true });
                  live.onFatalError(message);
                }
                break;
              default: break;
            }
          }
        } catch { /* ignore malformed */ }
      });

      // LiveKit does not auto-play an agent's remote audio. Keep one explicit
      // sink so a realtime TTS track reaches the OS output device.
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        detachRemoteAudio();
        const audio = createRealtimeAudioElement();
        remoteAudioTrackRef.current = track;
        remoteAudioElementRef.current = audio;
        track.attach(audio);
        configRef.current.onRemoteAudioElement?.(audio);
        void ensureDefaultAudioSink(audio).catch(() => { /* sink API optional */ });
        void audio.play().catch((error) => {
          updatePhase({
            phase: 'error',
            message: describeRealtimeMediaError('远端音频播放失败', error),
            fatal: false,
          });
        });
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track !== remoteAudioTrackRef.current) return;
        detachRemoteAudio();
      });

      // Any discovery that the transport is gone funnels into the shared
      // handleTransportDown helper (teardown + single auto-reconnect). The
      // room-identity guard makes a stale event from an already-torn-down
      // room a no-op, which is what keeps the watchdog and LiveKit's own
      // disconnect path from double-scheduling.
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) return;
        handleTransportDown(room, 'disconnected');
      });

      // LiveKit's internal resume for a transient signal/media loss. Do NOT
      // create a second room here: the client either resumes (Reconnected
      // below hands display back to the agent state) or eventually emits
      // Disconnected / trips the stale-room watchdog into the shared path.
      room.on(RoomEvent.Reconnecting, () => {
        if (stoppingRef.current || !readyRef.current) return;
        updatePhase({ phase: 'error', message: '连接恢复中…', fatal: false });
      });
      room.on(RoomEvent.Reconnected, () => {
        if (!readyRef.current || roomRef.current !== room) return;
        applyAgentStatePhase();
      });

      // 4. connect
      try {
        await room.connect(livekitUrl, token);
      } catch (err: any) {
        throw new Error(`LiveKit connect failed: ${String(err?.message || err)}`);
      }

      // 5. Validate + chunk the init payload before waiting for the
      // participant. A worker asks for a resend on this same topic if the
      // first reliable packet races its data listener; participant kind, not
      // lk.agent.state, unlocks the send.
      const initPayload = buildRealtimeSessionInit(await cfg.buildSessionInitPayload());
      const chunked = chunkSessionInitPayload(initPayload, cfg.roomName);
      const publishPart = (message: unknown) => {
        if (room.state !== 'connected') return;
        try {
          room.localParticipant.publishData(
            new TextEncoder().encode(JSON.stringify(message)),
            { reliable: true, topic: SESSION_INIT_TOPIC }
          );
        } catch {
          // The worker request and normal ready timeout provide the retry path.
        }
      };
      publishInitParts = () => {
        publishPart(chunked.header);
        for (const part of chunked.parts) publishPart(part);
      };

      // 6. wait for agent participant only as a dispatch/job diagnostic.
      const agent = await waitForAgent(room, 12000, publishInitParts);
      if (!agent) {
        await room.disconnect();
        updatePhase({ phase: 'error', message: 'agent participant timeout: worker 未以 Agent participant 加入 room；请检查 dispatch/job 是否到达 worker', fatal: false });
        return false;
      }
      agentRef.current = agent;

      // 7. The worker acknowledges receipt after reassembling the payload.
      // This separates a data-channel handshake loss from a later provider
      // failure.
      const handshake = await waitForHandshake(room, 12000);
      if (!handshake) {
        await room.disconnect();
        updatePhase({ phase: 'error', message: 'session.init handshake timeout: agent 已加入但未确认收到初始化配置', fatal: false });
        return false;
      }

      // 8. wait for session.ready (with timeout + retry)
      const ready = await waitForReady(room, 12000);
      if (!ready) {
        if (workerErrorRef.current) {
          const message = workerErrorRef.current;
          await room.disconnect();
          updatePhase({ phase: 'error', message, fatal: true });
          return false;
        }
        // Retry the already-cached reliable init once before the ready retry.
        publishInitParts();
        const retryReady = await waitForReady(room, 6000);
        if (!retryReady) {
          await room.disconnect();
          if (workerErrorRef.current) {
            updatePhase({ phase: 'error', message: workerErrorRef.current, fatal: true });
            return false;
          }
          updatePhase({ phase: 'error', message: 'session.ready timeout: worker 未在初始化后响应', fatal: true });
          return false;
        }
      }

      // 9. ready — open the mic immediately (livekit-client never auto-publishes)
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        setMicEnabledState(true);
      } catch (error) {
        updatePhase({ phase: 'error', message: describeRealtimeMediaError('麦克风启用失败', error), fatal: false });
      }
      readyRef.current = true;
      startStaleRoomWatchdog(room);
      updatePhase({ phase: 'listening' });
      return true;
    } catch (err: any) {
      if (roomRef.current) { try { roomRef.current.disconnect(); } catch {} roomRef.current = null; }
      updatePhase({ phase: 'error', message: String(err?.message || err), fatal: true });
      return false;
    }
  }, [detachRemoteAudio, handleTransportDown, startStaleRoomWatchdog, stopStaleRoomWatchdog, updatePhase]);

  // Wrapper: one automatic retry for transient setup failures, then a
  // scheduled single auto-reconnect used when a live session drops.
  const connect = useCallback(async () => {
    stoppingRef.current = false;
    const first = await attemptConnect();
    if (first) return;
    const cfg = configRef.current;
    if (!cfg.enabled || !cfg.active || stoppingRef.current) return;
    // Retry once after a short backoff; only if the failure was transient
    // (non-fatal phases) — fatal config errors are surfaced for manual action.
    setPhase(prev => {
      if (prev.phase === 'error' && prev.fatal) return prev;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void attemptConnect();
      }, 1500);
      return prev;
    });
  }, [attemptConnect]);

  // Manual/auto reconnect entrypoint exposed to the UI.
  const reconnect = useCallback(() => {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    void connect();
  }, [connect]);

  // Wire the auto-reconnect scheduler used by the Disconnected handler; runs
  // at most once per drop because each new connect resets the refs.
  scheduleReconnectRef.current = () => {
    if (stoppingRef.current) return;
    const cfg = configRef.current;
    if (!cfg.enabled || !cfg.active) return;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      void attemptConnect();
    }, 1200);
  };

  // Agent state attributes are only published after AgentSession.start. The
  // worker must receive session.init first, so use LiveKit's agent participant
  // semantics here and reserve lk.agent.state for display mapping above.
  function waitForAgent(room: Room, timeoutMs: number, onAgentJoined: () => void): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const isAgentParticipant = (participant: any) => participant?.kind === ParticipantKind.AGENT || participant?.isAgent === true;
      const handler = (participant: any) => {
        if (!isAgentParticipant(participant) || settled) return;
        settled = true;
        clearTimeout(timer);
        room.off(RoomEvent.ParticipantConnected, handler);
        onAgentJoined();
        resolve(participant.identity);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        room.off(RoomEvent.ParticipantConnected, handler);
        resolve(null);
      }, timeoutMs);
      const check = () => {
        for (const [, p] of room.remoteParticipants) {
          if (isAgentParticipant(p)) { handler(p); return; }
        }
      };
      check();
      if (!settled) room.on(RoomEvent.ParticipantConnected, handler);
    });
  }

  // Wait for the worker's acknowledgement that it reassembled session.init.
  // The room-wide handler records early arrivals so a fast ack cannot be missed.
  function waitForHandshake(room: Room, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (handshakeReceivedRef.current) { resolve(true); return; }
      const handler = (payload: Uint8Array, _participant?: any, _kind?: any, topic?: string) => {
        if (topic !== SESSION_EVENT_TOPIC) return;
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type === 'session.init.received') {
            handshakeReceivedRef.current = true;
            clearTimeout(timer);
            room.off('dataReceived', handler as any);
            resolve(true);
          }
        } catch { /* ignore malformed */ }
      };
      const timer = setTimeout(() => {
        room.off('dataReceived', handler as any);
        resolve(false);
      }, timeoutMs);
      room.on('dataReceived', handler as any);
    });
  }

  // wait for a session.ready event on the data channel
  function waitForReady(room: Room, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (readyRef.current) { resolve(true); return; }
      const timer = setTimeout(() => resolve(false), timeoutMs);
      const handler = {
        handle: (payload: Uint8Array, _participant?: any, _kind?: any, topic?: string) => {
          if (topic !== SESSION_EVENT_TOPIC) return;
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload));
            if (msg.type === 'session.ready') {
              clearTimeout(timer);
              room.off('dataReceived', handler.handle as any);
              resolve(true);
            }
          } catch { /* ignore */ }
        },
      };
      room.on('dataReceived', handler.handle as any);
    });
  }

  // ── lifecycle effect ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!config.enabled || !config.active) {
      if (roomRef.current) { stop(); }
      return;
    }
    connect();
    return () => { stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enabled, config.active, config.roomName]);

  // ── mic toggle ────────────────────────────────────────────────────────────
  const setMicEnabled = useCallback(async (on: boolean) => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return;
    try {
      await room.localParticipant.setMicrophoneEnabled(on);
      setMicEnabledState(on);
    } catch (error) {
      updatePhase({ phase: 'error', message: describeRealtimeMediaError('麦克风切换失败', error), fatal: false });
    }
  }, [updatePhase]);

  /**
   * Sends a bounded control envelope over the attachment topic. The renderer
   * publishData path hard-fails above min(SDP max-message-size, 64KiB), so
   * this guard never admits more than 60KiB; image raw bytes must go through
   * streamAttachmentBytes (byte stream), not this method.
   */
  const publishControlEvent = useCallback((event: Record<string, unknown>, opts?: { maxBytes?: number }) => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return false;
    const maxBytes = Math.max(14_000, Math.min(60_000, Number(opts?.maxBytes) || 14_000));
    try {
      const encoded = new TextEncoder().encode(JSON.stringify(event));
      if (encoded.byteLength > maxBytes) return false;
      room.localParticipant.publishData(encoded, { reliable: true, topic: 'rt.attachment' });
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Sends raw bytes over a LiveKit byte stream (topic fixed to the image
   * stream topic). The SDK fragments the payload internally (~15KiB chunks),
   * so multi-MB images never approach the per-packet publishData limit
   * (min(SDP max-message-size, 64KiB)); the receiver reassembles by stream.
   */
  const streamAttachmentBytes = useCallback(async (
    bytes: Uint8Array,
    meta: { mimeType: string; name: string; attributes: Record<string, string> },
  ) => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') throw new Error('实时通话未连接，图片未能发送');
    const localParticipant = room.localParticipant as Room['localParticipant'];
    if (typeof localParticipant.streamBytes !== 'function') {
      throw new Error('当前 LiveKit 客户端不支持字节流传输');
    }
    const writer = await localParticipant.streamBytes({
      topic: IMAGE_STREAM_TOPIC,
      mimeType: meta.mimeType,
      name: meta.name,
      totalSize: bytes.byteLength,
      attributes: meta.attributes,
    });
    await writer.write(bytes);
    await writer.close();
  }, []);

  // ── return ────────────────────────────────────────────────────────────────
  return {
    phase,
    micEnabled,
    stop,
    setMicEnabled,
    reconnect,
    publishControlEvent,
    streamAttachmentBytes,
  };
}
