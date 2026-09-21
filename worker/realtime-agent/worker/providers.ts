// Provider construction for the realtime call worker.
// Accepts optional override objects from session.init so a host app can push
// its own provider keys, model, baseURL etc. per session. Falls back to env
// defaults when overrides omit a field.
//
// The supported baseline is: STT = Groq (whisper-large-v3, OpenAI-compatible),
// LLM = any OpenAI-compatible chat/completions endpoint, TTS = ElevenLabs.
// MiniMax TTS works through the official plugin and is supported; Fish Audio
// is kept as an experimental / unsupported-baseline adapter due to unresolved
// runtime audio delivery issues.
import 'dotenv';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local'), override: true });
dotenv.config({ path: join(__dirname, '..', '.env'), override: false });

import * as openai from '@livekit/agents-plugin-openai';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import { stt as sttSdk } from '@livekit/agents';
// Official MiniMax plugin for the MiniMax TTS engine path.
import * as minimax from '@livekit/agents-plugin-minimax';
// Fish Audio TTS engine path (official plugin; model is a pass-through string).
// EXPERIMENTAL — see README "Fish Audio (experimental)".
import * as fishaudio from '@livekit/agents-plugin-fishaudio';
import {
  isLowEnergyGhostSegment,
  measureSttBufferEnergy,
  noteSttSkip,
  type AudioFrameLike,
  type SttMeasurementListener,
} from './sttGhostGuard.ts';

export const DEFAULT_INSTRUCTIONS =
  '你正在进行实时语音通话。请始终用中文、像打电话一样自然简短地回答（通常不超过两三句话）。' +
  '用户可能随时打断你；被打断后不要重复之前的内容，顺着用户的新话题继续说。';

export type SttOverrides = {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  language?: string;
};
export type LlmOverrides = {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  temperature?: number;
};
export type TtsOverrides = {
  provider?: string;
  apiKey?: string;
  voiceId?: string;
  model?: string;
  baseURL?: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[realtime-addon] Missing ${name}. Fill worker/.env.local (see .env.example).`
    );
  }
  return value;
}

function pick<T>(env: string, ov: T | undefined, fallback: T): T {
  return ov !== undefined ? ov : (process.env[env] as any) ?? fallback;
}

// Subclasses the segmented OpenAI-compatible STT (Groq path included) so the
// exact audio buffer handed to the provider can be measured, and Whisper can
// be denied buffers that are short AND globally near-silent (or contain no
// window at real voice energy). Guarded skips return an empty
// FINAL_TRANSCRIPT which the stream adapter drops silently — no user
// transcript, no LLM turn, no agent-state change. Model/provider/endpoint/
// language are untouched; recognize() is the only override.
class GuardedSegmentedStt extends openai.STT {
  #language: string;
  #onMeasurement: SttMeasurementListener | null;

  constructor(
    opts: ConstructorParameters<typeof openai.STT>[0],
    language: string,
    onMeasurement: SttMeasurementListener | null,
  ) {
    super(opts);
    this.#language = language;
    this.#onMeasurement = onMeasurement;
  }

  override async recognize(buffer: unknown, abortSignal?: AbortSignal): Promise<any> {
    const frames = Array.isArray(buffer)
      ? (buffer as AudioFrameLike[])
      : [buffer as AudioFrameLike];
    const stats = measureSttBufferEnergy(frames);
    const skip = isLowEnergyGhostSegment(stats);
    try {
      this.#onMeasurement?.(stats, skip);
    } catch {
      /* forensics must never break the STT path */
    }
    if (skip) {
      noteSttSkip();
      return {
        type: sttSdk.SpeechEventType.FINAL_TRANSCRIPT,
        alternatives: [{
          language: this.#language,
          text: '',
          startTime: 0,
          endTime: stats.submittedDurationMs / 1000,
          confidence: 0,
        }],
      };
    }
    return super.recognize(buffer as any, abortSignal);
  }
}

// STT: default routes the official OpenAI-compatible plugin at Groq
// (whisper-large-v3, segmented). Override provider/apiKey/model/baseURL/language.
// onMeasurement receives per-submission energy stats (and the guard verdict)
// for worker forensics; it must never throw into the STT path.
export async function buildStt(ov?: SttOverrides, onMeasurement?: SttMeasurementListener) {
  const provider = pick('STT_PROVIDER', ov?.provider, 'groq').toLowerCase();
  const language = (pick('STT_LANGUAGE', ov?.language, 'zh')) as any;
  if (provider === 'groq') {
    return new GuardedSegmentedStt({
      model: pick('STT_MODEL', ov?.model, 'whisper-large-v3'),
      // Credentials are deliberately worker-owned. Never accept browser/session keys.
      apiKey: requireEnv('GROQ_API_KEY'),
      baseURL: 'https://api.groq.com/openai/v1',
      language,
      useRealtime: false,
    }, language, onMeasurement ?? null);
  }
  if (provider === 'openai') {
    return new GuardedSegmentedStt({
      model: pick('STT_MODEL', ov?.model, 'gpt-4o-mini-transcribe'),
      apiKey: requireEnv('OPENAI_API_KEY'),
      language,
    }, language, onMeasurement ?? null);
  }
  if (provider === 'deepgram') {
    const deepgram = await import('@livekit/agents-plugin-deepgram');
    return new deepgram.STT({ model: pick('STT_MODEL', ov?.model, 'nova-3'), language: 'multi' } as any);
  }
  throw new Error(`[realtime-addon] Unknown STT provider "${provider}"`);
}

// Official OpenAI-compatible gateway routing: works with the host app's
// configured baseUrl/apiKey/model (chat/completions style), same values the
// app already uses for its text chat.
export function buildLlm(ov?: LlmOverrides) {
  return new openai.LLM({
    model: process.env.REALTIME_LLM_MODEL || ov?.model || requireEnv('REALTIME_LLM_MODEL'),
    apiKey: requireEnv('REALTIME_LLM_API_KEY'),
    baseURL: requireEnv('REALTIME_LLM_BASE_URL'),
    temperature: ov?.temperature ?? Number(process.env.REALTIME_LLM_TEMPERATURE ?? '0.85'),
  } as any);
}

// Single source of truth for the effective TTS provider id (session.init
// override > env > elevenlabs). buildTts and the worker's TTS text prep must
// agree on which engine is actually running.
export function resolveTtsProvider(ov?: TtsOverrides): string {
  return pick('TTS_PROVIDER', ov?.provider, 'elevenlabs').toLowerCase();
}

// TTS: ElevenLabs by default; provider 'minimax' routes the official MiniMax
// plugin; provider 'fishaudio' routes the official Fish Audio plugin
// (experimental, unsupported baseline — see README).
export function buildTts(ov?: TtsOverrides) {
  const provider = resolveTtsProvider(ov);
  if (provider === 'minimax') {
    const apiKey = requireEnv('MINIMAX_API_KEY');
    const voice = ov?.voiceId || process.env.MINIMAX_VOICE_ID || 'male-qn-qingse';
    const model = ov?.model || process.env.MINIMAX_MODEL || 'speech-2.8-hd';
    const baseURL = process.env.MINIMAX_BASE_URL?.trim() || undefined;
    let baseURLHost = 'plugin-default';
    if (baseURL) {
      try {
        baseURLHost = new URL(baseURL).host || 'invalid';
      } catch {
        baseURLHost = 'invalid';
      }
    }
    console.info('[minimax] TTS configured', { model, voice, baseURLHost });
    return new minimax.TTS({
      apiKey,
      voice,
      model,
      ...(baseURL ? { baseUrl: baseURL } : {}),
    });
  }
  if (provider === 'fishaudio') {
    // Experimental: kept so adopters can try it, but runtime audio delivery
    // has unresolved issues and it is NOT part of the supported baseline.
    const apiKey = requireEnv('FISH_API_KEY');
    const voiceId = ov?.voiceId || process.env.FISH_VOICE_ID || undefined;
    // Default to the free-tier model; the plugin passes the model string
    // through to the Fish API verbatim. If the API rejects it (e.g. free
    // model retired), the error surfaces here — never silently fall back
    // to a paid model.
    const model = ov?.model || process.env.FISH_MODEL || 's2.1-pro-free';
    console.info('[fishaudio] TTS configured (experimental)', { model, voice: voiceId || 'plugin-default' });
    return new fishaudio.TTS({
      apiKey,
      ...(voiceId ? { voiceId } : {}),
      model,
    });
  }
  return new elevenlabs.TTS({
    apiKey: requireEnv('ELEVENLABS_API_KEY'),
    voiceId: ov?.voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
    model: (ov?.model || process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5') as any,
  });
}
