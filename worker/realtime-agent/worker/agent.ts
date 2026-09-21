// Realtime call agent (LiveKit Agents worker, Node/TS).
//
// Chain: mic -> WebRTC (LiveKit SFU) -> VAD/end-of-turn -> STT -> host LLM
//        -> TTS (streaming) -> remote audio.
// Barge-in uses LiveKit Agents built-in adaptive interruption handling.
//
// The client pushes a `session.init` payload over the room data channel
// (topic "session.init") containing instructions, greeting, provider
// overrides, and the host-rendered conversation history. Large payloads are
// transferred as a header + numbered UTF-8 chunks and reassembled here (the
// per-packet publishData limit is 64KiB; a real conversation history easily
// exceeds it). If no init arrives within the wait window the worker falls
// back to env-only defaults so a bare standalone deployment still works.
import 'dotenv';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// .env.local wins over .env so local secrets stay out of git while keeping
// defaults shareable.
dotenv.config({ path: join(__dirname, '..', '.env.local'), override: true });
dotenv.config({ path: join(__dirname, '..', '.env'), override: false });

import {
  Agent,
  AgentSession,
  AgentSessionEventTypes,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  log,
  logMetrics,
  tool,
  type JobContext,
} from '@livekit/agents';
import { z } from 'zod';
import {
  buildStt,
  buildLlm,
  buildTts,
  resolveTtsProvider,
  DEFAULT_INSTRUCTIONS,
  type SttOverrides,
  type LlmOverrides,
  type TtsOverrides,
} from './providers.ts';
import { consumeRecentSttSkip } from './sttGhostGuard.ts';
import { prepareCallTtsText } from '../core/ttsText.ts';
import { seedHostHistory, type ContextAgent } from './attachmentContext.ts';
import { createAttachmentBridge, ATTACHMENT_CHANNEL_PAYLOAD_LIMIT_BYTES, type AttachmentBridge } from './attachmentBridge.ts';
import {
  SESSION_EVENT_TOPIC,
  SESSION_INIT_TOPIC,
  type RealtimeSessionInitPayload,
  type SessionInitHeaderMessage,
  type SessionInitPartMessage,
  type SessionReadyMessage,
} from '../core/attachmentProtocol.ts';

type RealtimeEvent = Record<string, unknown> & { type: string };

function redactSessionError(error: unknown, init: RealtimeSessionInitPayload | null): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [init?.llm?.apiKey, init?.stt?.apiKey, init?.tts?.apiKey]) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  return message;
}

const INIT_WAIT_MS = Number(process.env.REALTIME_INIT_WAIT_MS || 10000);

function makeEmitter(ctx: JobContext) {
  const encoder = new TextEncoder();
  return (event: RealtimeEvent) => {
    try {
      ctx.room.localParticipant?.publishData(
        encoder.encode(JSON.stringify({ ts: Date.now(), ...event })),
        { reliable: true, topic: SESSION_EVENT_TOPIC }
      );
    } catch {
      /* client may not be connected yet; console log below still records it */
    }
  };
}

// Wait up to INIT_WAIT_MS for a session.init payload on the room data channel.
// The payload is reassembled from a header + numbered UTF-8 parts; the
// reassembled byte length must match the declared total (corruption guard).
function waitForInit(ctx: JobContext, timeoutMs: number): Promise<RealtimeSessionInitPayload | null> {
  return new Promise((resolve) => {
    let settled = false;
    const header: { value: SessionInitHeaderMessage | null } = { value: null };
    const firstPartTotalBytes: { value: number } = { value: 0 };
    const parts = new Map<number, string>();
    const finish = (payload: RealtimeSessionInitPayload | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.room.off('dataReceived', onData as any);
      resolve(payload);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const onData = (payloadBytes: Uint8Array, _participant?: any, _kind?: any, topic?: string) => {
      if (settled || topic !== SESSION_INIT_TOPIC) return;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
        if (parsed?.type === 'session.init') {
          header.value = parsed as SessionInitHeaderMessage;
          tryFlush();
          // Broadcast a resend request so a client whose first reliable
          // packet raced this listener republishes immediately.
          try {
            ctx.room.localParticipant?.publishData(
              new TextEncoder().encode(JSON.stringify({ type: 'session.init.request' })),
              { reliable: true, topic: SESSION_INIT_TOPIC }
            );
          } catch { /* ignore */ }
          return;
        }
        if (parsed?.type === 'session.init.part') {
          const part = parsed as SessionInitPartMessage;
          if (!header.value || part.sessionId !== header.value.sessionId) return;
          if (part.part < 0 || part.part >= header.value.parts) return;
          if (parts.has(part.part)) return;
          if (firstPartTotalBytes.value === 0 && typeof part.totalBytes === 'number' && part.totalBytes > 0) {
            firstPartTotalBytes.value = part.totalBytes;
          }
          parts.set(part.part, part.data);
          tryFlush();
        }
      } catch {
        /* ignore malformed */
      }
    };
    const tryFlush = () => {
      const h = header.value;
      if (!h || parts.size < h.parts) return;
      const ordered: string[] = [];
      for (let i = 0; i < h.parts; i += 1) {
        const chunk = parts.get(i);
        if (chunk === undefined) return;
        ordered.push(chunk);
      }
      const serialized = ordered.join('');
      const declaredTotalBytes = (header.value ? firstPartTotalBytes.value : 0);
      const actualBytes = new TextEncoder().encode(serialized).byteLength;
      // Corruption guard: the client declares the full payload byte length on
      // every part; a mismatched reassembly is discarded.
      if (declaredTotalBytes > 0 && actualBytes !== declaredTotalBytes) {
        finish(null);
        return;
      }
      try {
        const payload = JSON.parse(serialized) as RealtimeSessionInitPayload;
        finish(payload);
      } catch {
        // Reassembly produced invalid JSON — treat as no init; the client's
        // own handshake timeout will surface the failure.
        finish(null);
      }
    };
    ctx.room.on('dataReceived', onData as any);
  });
}

// Wait for the client's acknowledgement gate: the client publishes its init
// only after the agent participant joins, so nothing extra is needed here.
// The session.end notice simply lets us stop cleanly.

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const logger = log();
    const emit = makeEmitter(ctx);
    logger.info({ room: ctx.room.name }, '[rt-agent] job accepted');

    // The client deliberately waits for this participant before publishing
    // session.init, so join first to avoid a waitForAgent/waitForInit deadlock.
    await ctx.connect();
    emit({ type: 'worker.job_accepted' });

    try {
      const init = await waitForInit(ctx, INIT_WAIT_MS);
      if (init) {
        logger.info({
          sttProvider: init.stt?.provider || null,
          sttModel: init.stt?.model || null,
          llmModel: init.llm?.model || null,
          ttsProvider: init.tts?.provider || null,
          ttsModel: init.tts?.model || null,
          hasSttKey: !!init.stt?.apiKey,
          hasLlmKey: !!init.llm?.apiKey,
          hasTtsKey: !!init.tts?.apiKey,
          historyItems: init.history?.length || 0,
        }, '[rt-agent] session.init received');
      } else {
        logger.warn('[rt-agent] no session.init within timeout; using env defaults');
      }
      emit({ type: 'session.init.received' });

      const stt = await buildStt(init?.stt, (stats, skipped) => {
        if (skipped) {
          emit({
            type: 'stt_skipped_low_energy',
            submittedDurationMs: stats.submittedDurationMs,
            speechDurationMs: stats.speechDurationMs,
            rms: stats.rms,
            peak: stats.peak,
            maxWindowRms: stats.maxWindowRms,
          });
          logger.info(stats, '[RealtimeSTT] skipped low-energy short segment');
        } else {
          logger.debug(stats, '[RealtimeSTT] stt audio measured');
        }
      });
      const llm = buildLlm(init?.llm);
      const tts = buildTts(init?.tts);
      // Same source of truth as buildTts: TTS text prep needs the provider id
      // to decide whether MiniMax-only pause tags may be inserted.
      const ttsProvider = resolveTtsProvider(init?.tts);
      const instructions = init?.instructions?.trim() || DEFAULT_INSTRUCTIONS;

      // Phase: on-demand PDF/text attachment reading. The full document is
      // held client-side; this tool only receives query-relevant chunks
      // (rate-limited by the client).
      let attachmentBridge: AttachmentBridge | null = null;
      const tools = [
        tool({
          name: 'read_call_attachment',
          description: '读取本次电话中用户发来的 PDF/文本附件的内容片段。当用户提到文档里的具体章节、页码、数据、结论，或你需要确认附件细节时调用。attachmentId 来自对话中出现的【本次电话附件】记录；不要编造。每次返回最相关的少量片段，可用不同 query / page 多次读取。',
          parameters: z.object({
            attachmentId: z.string().regex(/^att-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i).describe('对话中附件记录给出的 attachmentId'),
            query: z.string().max(200).optional().describe('想找的内容关键词，例如“第三章”“2024年营收”“实验方法”'),
            page: z.number().int().min(1).max(10_000).optional().describe('PDF 页码（用户明确提到页码时提供）'),
          }),
          execute: async ({ attachmentId, query, page }) => {
            if (!attachmentBridge) return '附件通道尚未就绪。';
            try {
              return await attachmentBridge.readAttachment(attachmentId, query, page);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger.warn({ err: message, attachmentId }, '[rt-agent] read_call_attachment failed');
              return `读取附件失败：${message}。请用电话口语向用户说明，不要中断通话。`;
            }
          },
        }),
      ];

      const agent = Agent.create({
        instructions,
        ...(tools.length > 0 ? { tools } : {}),
        // Tap the exact TTS frame stream the AgentSession forwards to its room
        // output? Not needed in the generic addon: metrics-only frame taps
        // were a private deployment diagnostic and are intentionally absent.
        ttsNode: async (agentCtx, text, modelSettings) => {
          // Keep the assistant item intact for the client. TTS alone uses the
          // language-tagged speech segment. The provider decides TTS-only
          // formatting: MiniMax pause tags are inserted for MiniMax and
          // stripped for everyone else (they would be read aloud).
          async function* selectRealtimeTtsText(
            input: AsyncIterable<string> | ReadableStream<string>,
          ) {
            let rawAssistantText = '';
            for await (const chunk of input as AsyncIterable<string>) {
              rawAssistantText += String(chunk || '');
            }
            const speechText = prepareCallTtsText(rawAssistantText, { provider: ttsProvider });
            if (speechText) yield speechText;
          }
          return await Agent.default.ttsNode(agentCtx.agent, selectRealtimeTtsText(text), modelSettings);
        },
      });

      // Seed the host conversation history before session.start so the first
      // LLM turn already sees the full host timeline. Best-effort: a failed
      // seed degrades to a call without history, never to a dead call.
      if (init?.history?.length) {
        try {
          const seeded = await seedHostHistory(agent as unknown as ContextAgent, init.history);
          logger.info({ seeded }, '[rt-agent] host history seeded into chatCtx');
        } catch (error) {
          logger.warn({ err: String(error) }, '[rt-agent] host history seed failed (continuing without)');
        }
      }

      const session = new AgentSession({
        stt,
        llm,
        tts,
        // The SDK default (true) replaces the conversation item text with the
        // TTS-aligned transcript, i.e. the processed speech text (MiniMax
        // pause tags, converted cues). That would leak speech formatting into
        // the client bubbles, persisted messages, and the LLM's own history.
        // Keep the item as the raw LLM text; the speech text stays TTS-only.
        useTtsAlignedTranscript: false,
        // A completed VAD turn with no STT final is otherwise unbounded in
        // this Agents version. Keep normal turns unchanged, but surface the
        // stalled-pipeline case so it can be re-armed once below.
        transcriptionTimeout: 10_000,
        turnHandling: {
          interruption: {
            resumeFalseInterruption: true,
            falseInterruptionTimeout: 1000,
            mode: 'adaptive',
          },
          endpointing: { mode: 'dynamic', minDelay: 400, maxDelay: 2500 },
          // segmented (non-realtime) STT produces no interims -> keep this off
          preemptiveGeneration: { enabled: false },
        },
        connOptions: {
          llmConnOptions: { maxRetry: 1, retryIntervalMs: 2000, timeoutMs: 60000 },
          ttsConnOptions: { maxRetry: 1, retryIntervalMs: 2000, timeoutMs: 30000 },
          sttConnOptions: { maxRetry: 1, retryIntervalMs: 2000, timeoutMs: 30000 },
        } as any,
      });

      // Keep the SDK's default-VAD ownership; only reject shorter speech bursts.
      if (session.vad instanceof inference.VAD) {
        session.vad.updateOptions({ minSpeechDuration: 150 });
      }

      // --- latency chain state ---
      let agentSpeaking = false;
      let userSpeaking = false;
      let sttRecoveryAttempted = false;
      let sttRearmInFlight = false;

      const EV: Record<string, any> = AgentSessionEventTypes as any;
      const bind = (enumKey: string, fallback: string, fn: (ev: any) => void) => {
        const name = EV[enumKey] ?? fallback;
        session.on(name as any, fn);
      };

      // Current Agents exposes state changes; use the public events so local
      // turn bookkeeping tracks every turn without changing the framework's
      // own VAD/interruption handling.
      bind('UserStateChanged', 'user_state_changed', (ev: any) => {
        if (ev?.newState === 'speaking') {
          userSpeaking = true;
          attachmentBridge?.noteUserTurnStarted();
          return;
        }
        if (ev?.newState === 'listening') {
          userSpeaking = false;
        }
      });

      bind('AgentStateChanged', 'agent_state_changed', (ev: any) => {
        if (ev?.newState === 'speaking') {
          agentSpeaking = true;
          return;
        }
        if (ev?.oldState === 'speaking' && ev?.newState !== 'speaking') {
          agentSpeaking = false;
          // The agent has completed its output and the user has not barged
          // in. Re-create the segmented STT stream at this stable boundary so
          // a provider stream that closed after the previous turn cannot
          // leave later microphone audio unconsumed.
          if (!userSpeaking) void rearmSttPipeline('agent_speech_end');
        }
      });

      const rearmSttPipeline = async (reason: 'agent_speech_end' | 'error' | 'timeout' | 'tts_error') => {
        if (sttRearmInFlight) return;
        sttRearmInFlight = true;
        try {
          // updateOptions({ stt }) is the documented narrow reset: it stops
          // the old STT forward/consumer tasks and creates one fresh pipeline
          // without reconnecting the room or changing provider settings.
          await (agent as any).updateOptions?.({ stt });
          emit({ type: 'stt_pipeline_rearmed', reason });
          logger.info({ reason }, '[rt-agent] STT pipeline re-armed');
        } catch (error) {
          const message = redactSessionError(error, init);
          emit({ type: 'stt_pipeline_recovery_failed', reason, message });
          logger.error({ reason, err: message }, '[rt-agent] STT pipeline recovery failed');
        } finally {
          sttRearmInFlight = false;
        }
      };

      const recoverSttPipeline = async (reason: 'error' | 'timeout') => {
        if (sttRecoveryAttempted) return;
        sttRecoveryAttempted = true;
        await rearmSttPipeline(reason);
      };

      bind('UserTranscriptionTimeout', 'user_transcription_timeout', (ev: any) => {
        const skippedByGuard = consumeRecentSttSkip();
        emit({ type: 'stt_timeout', speechDurationMs: ev?.speechDuration ?? null, skippedByGuard });
        if (skippedByGuard) {
          // The ghost guard dropped this turn on purpose; do not spend the
          // one-shot STT re-arm on it.
          logger.info({ speechDurationMs: ev?.speechDuration ?? null }, '[rt-agent] VAD turn dropped by low-energy STT guard');
          return;
        }
        logger.warn({ speechDurationMs: ev?.speechDuration ?? null }, '[rt-agent] VAD turn produced no transcript');
        void recoverSttPipeline('timeout');
      });

      bind('Error', 'error', (ev: any) => {
        const error = ev?.error;
        const type = String(error?.type || 'unknown');
        const message = redactSessionError(error, init);
        emit({ type: 'agent_error', source: type, message });
        logger.warn({ source: type, err: message }, '[rt-agent] agent session error');
        if (type === 'stt_error') void recoverSttPipeline('error');
        // A TTS provider failure fails before the agent ever reaches the
        // speaking state, so the normal speech-end re-arm never runs and
        // later mic audio goes unconsumed. Treat it as non-fatal text-only
        // degradation: re-arm the same narrow updateOptions({ stt }) path,
        // only while the user is not mid-utterance. Not recoverSttPipeline:
        // a balance error recurs every turn, so the one-shot guard must not
        // consume it; sttRearmInFlight already prevents double re-arms.
        if (type === 'tts_error' && !userSpeaking) void rearmSttPipeline('tts_error');
        // Image direct vision: only when the provider explicitly rejects
        // image input do we remove the image message and notify the client
        // to downgrade. Other errors are reported as-is — never silently
        // swapped away on 5xx/timeout/429.
        void attachmentBridge?.notifySessionError(error).then((handled) => {
          if (handled) logger.info({ source: type }, '[rt-agent] vision unsupported fallback requested');
        });
      });

      bind('UserInputTranscribed', 'user_input_transcribed', (ev: any) => {
        emit({ type: 'user_transcript', text: ev.transcript, isFinal: !!ev.isFinal, itemId: ev.itemId || null });
        if (ev.isFinal) attachmentBridge?.noteUserTurnStarted();
      });

      bind('ConversationItemAdded', 'conversation_item_added', (ev: any) => {
        const item = ev.item;
        emit({
          type: 'item_added',
          role: item?.role,
          interrupted: !!item?.interrupted,
          text: String(item?.textContent ?? ''),
          itemId: item?.id || null,
        });
      });

      bind('MetricsCollected', 'metrics_collected', (ev: any) => {
        logMetrics(ev.metrics);
      });

      await session.start({ agent, room: ctx.room });
      // Attachment bridge: client data channel (manifest registration, image
      // chunked direct vision, read_call_attachment request/response,
      // vision-unsupported downgrade).
      attachmentBridge = createAttachmentBridge({
        ctx,
        getAgent: () => agent,
        isUserSpeaking: () => userSpeaking,
        isAgentSpeaking: () => agentSpeaking,
        generateReply: async (replyInstructions) => { await session.generateReply({ instructions: replyInstructions }); },
        emit,
        logger,
      });
      const onAttachmentData = (payload: Uint8Array, _participant: unknown, _kind: unknown, topic?: string) => {
        if (topic !== 'rt.attachment' || payload.byteLength > ATTACHMENT_CHANNEL_PAYLOAD_LIMIT_BYTES) return;
        try {
          attachmentBridge?.handleRendererMessage(JSON.parse(new TextDecoder().decode(payload)));
        } catch {
          // Room data is untrusted; malformed control data is ignored.
        }
      };
      ctx.room.on('dataReceived', onAttachmentData as any);
      // Image raw bytes go over a byte stream (SDK-internal chunking, bypassing
      // the single DataPacket cap); control messages stay on the rt.attachment
      // topic.
      attachmentBridge?.registerByteStreamHandler();
      ctx.addShutdownCallback(async () => {
        ctx.room.off('dataReceived', onAttachmentData as any);
        attachmentBridge?.dispose();
        logger.info({ usage: session.usage }, '[rt-agent] session usage');
        emit({ type: 'session_closed' });
      });

      const readyMessage: SessionReadyMessage = { type: 'session.ready' };
      emit(readyMessage);
      logger.info('[rt-agent] session ready');

      const greeting = init?.greeting?.trim();
      if (greeting) {
        session.say(greeting);
      } else {
        session.say('喂？我在线了，说点什么吧。');
      }
    } catch (err: any) {
      // Provider misconfiguration etc. must fail fast, never hang the worker.
      const safeMessage = redactSessionError(err, null);
      logger.error({ err: safeMessage }, '[rt-agent] entry failed');
      emit({ type: 'worker_error', message: safeMessage });
      return;
    }
  },
});

const workerOptions = { agent: fileURLToPath(import.meta.url) };
// Named dispatch is the default so multiple addon workers can coexist in one
// LiveKit deployment; REALTIME_AGENT_DISPATCH_MODE=auto opts into auto mode.
if (process.env.REALTIME_AGENT_DISPATCH_MODE !== 'auto') {
  Object.assign(workerOptions, { agentName: process.env.REALTIME_AGENT_NAME || 'sully-realtime' });
}
cli.runApp(new ServerOptions(workerOptions));
