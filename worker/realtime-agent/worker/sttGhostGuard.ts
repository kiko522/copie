// Short low-energy guard for segmented STT submissions (STT ghost transcript fix).
//
// Forensics: the framework's STTStreamAdapter hands recognize() the VAD's
// END_OF_SPEECH speech buffer, which contains prefixPaddingDuration (500ms)
// of preroll plus every window above the deactivation threshold (p > 0.35)
// while the VAD is in the speaking state — so breath/room noise sustains
// "speech" and the buffer is dominated by near-silence. Whisper then emits
// subtitle-style hallucinations on such audio ("好", "谢谢大家",
// "中文字幕志愿者 李宗盛").
//
// Guard semantics: judge the buffer by real audio energy, never by keywords.
// Real short replies ("嗯", "好", "对") carry clear voice energy and pass
// through unchanged; long speech is never evaluated against the short window.
// Energy floors reuse the app's own diagnostics constants
// (utils/realtimeAudioDiagnostics.ts: NON_SILENT_RMS=0.003, SPEECH_RMS=0.01).
//
// Tunables are env-overridable so a misfire can be corrected without a code
// change; SULLY_STT_GUARD=0 disables skipping entirely (measurement continues).

export type AudioFrameLike = {
  data?: ArrayBufferLike | ArrayBufferView;
  sampleRate?: number;
  channels?: number;
};

export type SttEnergyStats = {
  submittedDurationMs: number;
  /** Total duration of 32ms windows at or above the silence floor. */
  speechDurationMs: number;
  rms: number;
  peak: number;
  /** Highest single-window RMS in the buffer. */
  maxWindowRms: number;
  windowCount: number;
};

export type SttMeasurementListener = (stats: SttEnergyStats, skipped: boolean) => void;

const GUARD_WINDOW_MS = 32;
// Windows below this are silence; windows at/above it count toward the
// real speech portion of the buffer.
const SILENCE_RMS_FLOOR = Number(process.env.SULLY_STT_SILENCE_RMS || 0.003);
// Skip path A (task spec): short segment AND globally near-silent buffer.
const SHORT_SEGMENT_WINDOW_MS = Number(process.env.SULLY_STT_GUARD_SHORT_MS || 300);
const LOW_ENERGY_RMS = Number(process.env.SULLY_STT_GUARD_LOW_RMS || 0.0035);
// Skip path B: not a single 32ms window reaches real voice energy anywhere
// in the buffer (app SPEECH_RMS floor). Whisper has no intelligible speech
// to work with on such a buffer; any output is hallucination. Path A alone
// cannot catch long noise segments that the VAD misclassified as speech.
const SPEECH_PRESENCE_RMS = Number(process.env.SULLY_STT_GUARD_SPEECH_RMS || 0.01);
const GUARD_ENABLED = process.env.SULLY_STT_GUARD !== '0';

export function measureSttBufferEnergy(frames: AudioFrameLike[]): SttEnergyStats {
  let totalSamples = 0;
  let totalSquares = 0;
  let peak = 0;
  let speechDurationMs = 0;
  let submittedDurationMs = 0;
  let maxWindowRms = 0;
  let windowCount = 0;

  for (const frame of frames) {
    const raw = frame.data;
    if (!raw) continue;
    const samples = ArrayBuffer.isView(raw)
      ? new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / Int16Array.BYTES_PER_ELEMENT))
      : new Int16Array(raw);
    if (samples.length === 0) continue;
    const sampleRate = Number(frame.sampleRate) > 0 ? Number(frame.sampleRate) : 48000;
    const channels = Number(frame.channels) > 0 ? Number(frame.channels) : 1;
    const frameDurationMs = (samples.length / channels) * 1000 / sampleRate;
    submittedDurationMs += frameDurationMs;

    const windowSampleCount = Math.max(1, Math.round(sampleRate * GUARD_WINDOW_MS / 1000) * channels);
    for (let start = 0; start < samples.length; start += windowSampleCount) {
      const end = Math.min(samples.length, start + windowSampleCount);
      let windowSquares = 0;
      let windowPeak = 0;
      for (let i = start; i < end; i += 1) {
        const normalized = samples[i] / 32768;
        windowSquares += normalized * normalized;
        const abs = Math.abs(normalized);
        if (abs > windowPeak) windowPeak = abs;
      }
      const windowSampleTotal = end - start;
      const windowRms = Math.sqrt(windowSquares / windowSampleTotal);
      totalSquares += windowSquares;
      totalSamples += windowSampleTotal;
      if (windowPeak > peak) peak = windowPeak;
      if (windowRms > maxWindowRms) maxWindowRms = windowRms;
      windowCount += 1;
      if (windowRms >= SILENCE_RMS_FLOOR) {
        speechDurationMs += (windowSampleTotal / channels) * 1000 / sampleRate;
      }
    }
  }

  return {
    submittedDurationMs: Math.round(submittedDurationMs),
    speechDurationMs: Math.round(speechDurationMs),
    rms: totalSamples > 0 ? Number(Math.sqrt(totalSquares / totalSamples).toFixed(6)) : 0,
    peak: Number(peak.toFixed(6)),
    maxWindowRms: Number(maxWindowRms.toFixed(6)),
    windowCount,
  };
}

export function isLowEnergyGhostSegment(stats: SttEnergyStats): boolean {
  if (!GUARD_ENABLED) return false;
  // Path A: short + globally near-silent (preroll-padded micro burst).
  if (stats.speechDurationMs < SHORT_SEGMENT_WINDOW_MS && stats.rms < LOW_ENERGY_RMS) return true;
  // Path B: no window anywhere reaches real voice energy.
  if (stats.maxWindowRms < SPEECH_PRESENCE_RMS) return true;
  return false;
}

// UserTranscriptionTimeout coordination: a guarded skip drops the transcript,
// so the session reports a VAD turn with no STT final ~10s later. The timeout
// handler consumes this marker to tell guard-drops apart from genuinely
// stalled pipelines (which need the one-shot STT re-arm).
const STT_SKIP_MARKER_MAX_AGE_MS = 15_000;
let lastSttSkipAt = 0;

export function noteSttSkip(): void {
  lastSttSkipAt = Date.now();
}

export function consumeRecentSttSkip(): boolean {
  if (lastSttSkipAt === 0) return false;
  const recent = Date.now() - lastSttSkipAt <= STT_SKIP_MARKER_MAX_AGE_MS;
  lastSttSkipAt = 0;
  return recent;
}

