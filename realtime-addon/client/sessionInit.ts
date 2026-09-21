/**
 * Client-side ownership of the session.init contract.
 *
 * The renderer sends only non-secret provider choices and models. Provider
 * credentials stay in the Windows worker environment and never enter the
 * browser, LiveKit data channel, repository, or token server.
 *
 * The payload may exceed the per-packet publishData limit (a 500-message
 * history is easily >64KiB), so the init is transferred as a small header
 * plus numbered UTF-8 chunks that the worker reassembles and checksums by
 * total byte length.
 */
import {
  SESSION_INIT_TOPIC,
  type RealtimeHistoryItem,
  type RealtimeLlmConfig,
  type RealtimeSessionInitPayload,
  type RealtimeSttConfig,
  type RealtimeTtsConfig,
  type SessionInitHeaderMessage,
  type SessionInitPartMessage,
} from '../core/attachmentProtocol.ts';

export type { RealtimeSessionInitPayload };

const text = (value: unknown): string => String(value ?? '').trim();

export type RealtimeSttProvider = 'groq' | 'openai' | 'deepgram';
export type RealtimeTtsProvider = 'elevenlabs' | 'minimax' | 'fishaudio';

const DEFAULT_STT_MODEL: Record<RealtimeSttProvider, string> = {
  groq: 'whisper-large-v3',
  openai: 'gpt-4o-mini-transcribe',
  deepgram: 'nova-3',
};

const HISTORY_MAX_ITEMS = 400;
const HISTORY_ITEM_MAX_CHARS = 24_000;

export function resolveRealtimeStt(value: {
  provider?: string;
  apiKey?: string;
  model?: string;
  language?: string;
  baseURL?: string;
}): RealtimeSttConfig {
  const rawProvider = text(value.provider).toLowerCase() || 'groq';
  if (rawProvider !== 'groq' && rawProvider !== 'openai' && rawProvider !== 'deepgram') {
    throw new Error(`Realtime does not support STT provider "${rawProvider}"`);
  }
  const provider = rawProvider as RealtimeSttProvider;
  return {
    provider,
    model: text(value.model) || DEFAULT_STT_MODEL[provider],
    language: text(value.language) || 'zh',
    ...(text(value.baseURL) ? { baseURL: text(value.baseURL) } : {}),
  };
}

/**
 * Validate and normalize the full init payload. Provider fields are optional
 * at the type level so a host can fall back to worker-side env defaults, but
 * the stable baseline (STT + LLM + TTS from the host) is the expected shape.
 */
export function buildRealtimeSessionInit(input: RealtimeSessionInitPayload): RealtimeSessionInitPayload {
  const stt = input.stt ? resolveRealtimeStt(input.stt) : undefined;
  let llm: RealtimeLlmConfig | undefined;
  if (input.llm) {
    llm = {
      ...(text(input.llm.baseURL) ? { baseURL: text(input.llm.baseURL).replace(/\/+$/, '') } : {}),
      model: text(input.llm.model),
      temperature: Number(input.llm.temperature),
    };
    if (!llm.model || !Number.isFinite(llm.temperature)) {
      throw new Error('Realtime requires an LLM model and temperature');
    }
  }
  let tts: RealtimeTtsConfig | undefined;
  if (input.tts) {
    const ttsProvider = text(input.tts.provider).toLowerCase();
    if (ttsProvider !== 'elevenlabs' && ttsProvider !== 'minimax' && ttsProvider !== 'fishaudio') {
      throw new Error(`Realtime does not support TTS provider "${ttsProvider}"`);
    }
    tts = {
      provider: ttsProvider,
      model: text(input.tts.model),
      ...(text(input.tts.voiceId) ? { voiceId: text(input.tts.voiceId) } : {}),
      ...(text(input.tts.baseURL) ? { baseURL: text(input.tts.baseURL) } : {}),
    };
    if (!tts.model) {
      throw new Error(`Realtime TTS requires a ${tts.provider} model`);
    }
  }

  const history = (input.history || [])
    .filter((item): item is RealtimeHistoryItem =>
      (item.role === 'user' || item.role === 'assistant')
      && typeof item.content === 'string'
      && item.content.trim().length > 0)
    .slice(-HISTORY_MAX_ITEMS)
    .map((item) => ({ role: item.role, content: item.content.slice(0, HISTORY_ITEM_MAX_CHARS) }));

  return {
    ...(text(input.instructions) ? { instructions: text(input.instructions) } : {}),
    ...(text(input.greeting) ? { greeting: text(input.greeting) } : {}),
    ...(stt ? { stt } : {}),
    ...(llm ? { llm } : {}),
    ...(tts ? { tts } : {}),
    ...(history.length ? { history } : {}),
  };
}

/** Per-part UTF-8 byte budget: safely below the 64KiB publishData hard limit. */
const INIT_PART_MAX_BYTES = 48_000;

export type ChunkedSessionInit = {
  header: SessionInitHeaderMessage;
  parts: SessionInitPartMessage[];
};

/**
 * Split a validated init payload into a header + numbered UTF-8 chunks.
 * Chunks are cut at code-point boundaries so no character is ever split
 * mid-sequence; the worker verifies the reassembled byte length.
 */
export function chunkSessionInitPayload(payload: RealtimeSessionInitPayload, sessionId: string): ChunkedSessionInit {
  const encoder = new TextEncoder();
  const serialized = JSON.stringify(payload);
  const totalBytes = encoder.encode(serialized).byteLength;
  const parts: SessionInitPartMessage[] = [];
  let buffer = '';
  let bufferedBytes = 0;
  // Iterate by code points: a surrogate pair (or any multi-byte char) is
  // never split across parts.
  for (const char of serialized) {
    const charBytes = encoder.encode(char).byteLength;
    if (bufferedBytes + charBytes > INIT_PART_MAX_BYTES && buffer) {
      parts.push({ type: 'session.init.part', sessionId, part: parts.length, totalBytes, data: buffer });
      buffer = '';
      bufferedBytes = 0;
    }
    buffer += char;
    bufferedBytes += charBytes;
  }
  if (buffer || parts.length === 0) {
    parts.push({ type: 'session.init.part', sessionId, part: parts.length, totalBytes, data: buffer });
  }
  return {
    header: { type: 'session.init', protocol: 1, parts: parts.length, sessionId },
    parts,
  };
}

export const SESSION_INIT_PUBLISH_TOPIC = SESSION_INIT_TOPIC;
