/**
 * Realtime call attachment protocol — the wire contract between the browser
 * client and the LiveKit agent worker.
 *
 * Platform-neutral by design: pure types and constants only. No Electron IPC,
 * no Node APIs, no DOM dependencies. The worker (Node) and the client (browser)
 * both import this module.
 *
 * Design constraints:
 * - Image raw bytes travel over a LiveKit byte stream (the SDK chunks them
 *   internally at ~15KiB, well under the per-packet publishData limit of
 *   min(SDP max-message-size, 64KiB)). Control messages stay small JSON
 *   envelopes on a reliable data channel.
 * - The full PDF/text content lives on the client. The worker only ever holds
 *   a lightweight manifest plus on-demand read results.
 */

export type CallAttachmentKind = 'image' | 'pdf' | 'text';

export type CallAttachmentManifest = {
  attachmentId: string;
  callSessionId: string;
  kind: CallAttachmentKind;
  fileName: string;
  mimeType: string;
  byteLength: number;
  /** PDF page count (only when the parsing side can provide it reliably). */
  pageCount?: number;
  /** Document chunk count (pdf/text). */
  chunkCount?: number;
  /**
   * Summary produced by an async analyzer over its **actual read window**
   * (a single ~96k-char injection budget today). For large PDFs it may only
   * cover the front of the document — it never claims to summarize everything.
   * Optional: the baseline flow works without any async analyzer.
   */
  analysisSummary?: string;
  /**
   * Lightweight whole-document overview material sampled across positions
   * (start / ~25% / ~50% / ~75% / end). This is sampled material, not an
   * LLM-generated or human-confirmed summary; specific details still require
   * read_call_attachment.
   */
  documentOverview?: string;
};

/** client → worker: register/update an attachment manifest. restore=true after a reconnect. */
export type CallAttachmentManifestMessage = {
  type: 'attachment.manifest';
  manifest: CallAttachmentManifest;
  restore?: boolean;
};

/**
 * client → worker: metadata envelope for an image byte stream (sent as a
 * normal reliable DataPacket). The image **raw bytes** travel on the byte
 * stream (IMAGE_STREAM_TOPIC), correlated by the attachmentId in the stream
 * attributes. Both channels are required: a meta without bytes, or bytes
 * without meta, never enter the model context (corruption guard).
 */
export type CallAttachmentImageMetaMessage = {
  type: 'attachment.image.meta';
  attachmentId: string;
  callSessionId: string;
  mimeType: string;
  byteLength: number;
  restore: boolean;
};

/** worker → client: on-demand document chunk read. */
export type CallAttachmentReadRequestMessage = {
  type: 'attachment.read.request';
  requestId: string;
  attachmentId: string;
  callSessionId: string;
  query?: string;
  page?: number;
};

export type CallAttachmentReadChunk = {
  index: number;
  page: number | null;
  text: string;
};

/** client → worker: read result (bounded by READ_RESULT_MAX_CHARS). */
export type CallAttachmentReadResultMessage = {
  type: 'attachment.read.result';
  requestId: string;
  attachmentId: string;
  ok: boolean;
  totalChunks?: number;
  returned?: CallAttachmentReadChunk[];
  /** Empty-result or boundary note, e.g. "no chunks matched the query". */
  note?: string;
  error?: string;
};

/** worker → client: the main model explicitly rejected image input. */
export type CallAttachmentVisionUnsupportedMessage = {
  type: 'attachment.vision_unsupported';
  attachmentId: string;
  message: string;
};

export type CallAttachmentRendererMessage =
  | CallAttachmentManifestMessage
  | CallAttachmentImageMetaMessage;

export type CallAttachmentWorkerMessage =
  | CallAttachmentReadRequestMessage
  | CallAttachmentVisionUnsupportedMessage;

// ── protocol boundary constants ─────────────────────────────────────────────

/**
 * Image raw bytes go over a LiveKit byte stream (the SDK chunks at ~15KiB and
 * handles reassembly on both sides; the renderer publishData hard limit is
 * min(SDP max-message-size, 64KiB)). This only bounds the total bytes allowed
 * per image (matches the private app's 8MB attachment creation cap).
 */
export const IMAGE_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
/** Room data topic used for image byte streams. */
export const IMAGE_STREAM_TOPIC = 'sully.attachment.image';

/** Wire budget for manifest.analysisSummary (the full text stays client-side). */
export const MANIFEST_ANALYSIS_SUMMARY_WIRE_MAX_CHARS = 4_000;
/** Wire budget for manifest.documentOverview sampled material. */
export const MANIFEST_OVERVIEW_WIRE_MAX_CHARS = 6_000;
/** Budget applied when the worker injects analysisSummary into the agent chatCtx. */
export const ANALYSIS_SUMMARY_INJECTION_MAX_CHARS = 1_200;
/** Budget applied when the worker injects documentOverview into the agent chatCtx. */
export const DOCUMENT_OVERVIEW_INJECTION_MAX_CHARS = 1_600;

/** Per-read tool result budget (chunk count and total characters). */
export const READ_RESULT_MAX_CHUNKS = 3;
export const READ_RESULT_MAX_CHARS = 6_000;
export const READ_REQUEST_TIMEOUT_MS = 10_000;

/** Auto-reply window after an image enters a pending multimodal turn. */
export const IMAGE_PENDING_REPLY_WINDOW_MS = 5_000;

/** Max payload for one control event (manifest / image.meta / read result);
 * must stay below the 64KiB publishData hard limit. */
export const CALL_ATTACHMENT_MAX_PAYLOAD_BYTES = 14_000;

export const CALL_ATTACHMENT_ID_RE = /^att-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const CALL_SESSION_ID_RE = /^[a-zA-Z0-9:_-]{1,160}$/;
export const CALL_TRANSFER_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

// ── session.init / session history protocol ─────────────────────────────────

/**
 * session.init control topic. The init payload (instructions, greeting,
 * providers, conversation history) is JSON over this topic; the worker asks
 * for a resend on the same topic when its data listener raced the first
 * reliable packet.
 */
export const SESSION_INIT_TOPIC = 'session.init';
/** Worker → client event topic (transcripts, agent state, worker errors). */
export const SESSION_EVENT_TOPIC = 'rt.event';

/** Client → worker: multi-part session init. Part 0 of N. */
export type SessionInitHeaderMessage = {
  type: 'session.init';
  protocol: 1;
  parts: number;
  sessionId: string;
};

/** Client → worker: one chunk of the session init payload (part is 0-based). */
export type SessionInitPartMessage = {
  type: 'session.init.part';
  sessionId: string;
  part: number;
  /** Total serialized byte length of the reassembled payload (corruption check). */
  totalBytes: number;
  data: string;
};

/** Worker → client: ack that a full session init payload was received. */
export type SessionInitReceivedMessage = {
  type: 'session.init.received';
};

/** Worker → client: the agent session is live and will start speaking. */
export type SessionReadyMessage = {
  type: 'session.ready';
};

/** Client → worker: hangup notice (best effort before disconnect). */
export type SessionEndMessage = {
  type: 'session.end';
};

export type RealtimeSttConfig = {
  provider: string;
  apiKey: string;
  /** Optional at the wire boundary: the worker falls back to per-provider env
   * defaults, and the client-side validator (client/sessionInit.ts) fills it. */
  model?: string;
  language: string;
  baseURL?: string;
};

export type RealtimeLlmConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
};

export type RealtimeTtsConfig = {
  provider: string;
  apiKey: string;
  voiceId?: string;
  model: string;
  baseURL?: string;
};

/**
 * One past conversation turn, pre-rendered by the host app. The core never
 * sees Sully messages — the adapter converts host history into these items.
 */
export type RealtimeHistoryItem = {
  role: 'user' | 'assistant';
  content: string;
};

export type RealtimeSessionInitPayload = {
  instructions?: string;
  greeting?: string;
  stt?: RealtimeSttConfig;
  llm?: RealtimeLlmConfig;
  tts?: RealtimeTtsConfig;
  /** Pre-rendered host conversation history, oldest first. */
  history?: RealtimeHistoryItem[];
};

// ── worker → client event vocabulary ────────────────────────────────────────

export type UserTranscriptEvent = { type: 'user_transcript'; text: string; isFinal: boolean };
export type AgentItemEvent = { type: 'item_added'; role: string; interrupted: boolean; text: string };
export type AgentErrorEvent = { type: 'agent_error'; source: string; message: string };
export type WorkerErrorEvent = { type: 'worker_error'; message: string };
export type UserBargeInEvent = { type: 'user_barge_in'; duringSpeechMs?: number };
export type InterruptConfirmedEvent = { type: 'interrupt_confirmed'; stopDelayMs?: number };
export type VisionUnsupportedEvent = {
  type: 'attachment.vision_unsupported';
  attachmentId: string;
  message: string;
};

export type AttachmentChannelMessage =
  | CallAttachmentReadRequestMessage
  | CallAttachmentVisionUnsupportedMessage;

