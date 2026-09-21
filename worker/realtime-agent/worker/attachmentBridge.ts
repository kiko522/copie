// Realtime attachment bridge: the worker-side attachment protocol state machine.
//
// Responsibilities (protocol constants & types in core/attachmentProtocol.ts):
// - Receive client manifest registrations (including post-reconnect restores)
//   and inject lightweight chatCtx messages (analysisSummary = the analyzer's
//   actual read-window summary + documentOverview = sampled whole-document
//   overview; full documents stay client-side).
// - Receive image byte streams (topic sully.attachment.image, SDK-chunked),
//   correlate with the earlier attachment.image.meta envelope by attachmentId,
//   assemble the data URL → add directly as a user image message into the
//   current main model context (direct vision; no separate vision-analysis
//   request). The image enters a short pending multimodal turn: by default it
//   waits for the immediately following user final transcript to merge into
//   ONE generation; only when no user speech/text arrives within the window
//   does the image itself trigger a reply.
//   Reassembly guards: streams without meta are dropped; byteLength-mismatch
//   assemblies are dropped; duplicate meta/streams never create a second
//   image message.
// - Provide the read_call_attachment request/response channel: send
//   attachment.read.request to the client, await attachment.read.result
//   (with timeout).
// - Catch "provider explicitly rejected image input" errors, remove the image
//   message, and notify the client to downgrade. Generic errors (429/5xx/
//   timeouts) never trigger this downgrade.
//
// Platform constraints: this module only depends on the LiveKit room data
// channel and injection callbacks — no Electron IPC, no local paths, no
// host-app internals.
import type { Agent, JobContext } from '@livekit/agents';
import { isVisionUnsupportedError } from '../core/visionUnsupported.ts';
import {
  CALL_ATTACHMENT_ID_RE,
  CALL_ATTACHMENT_MAX_PAYLOAD_BYTES,
  CALL_SESSION_ID_RE,
  IMAGE_PENDING_REPLY_WINDOW_MS,
  IMAGE_STREAM_TOPIC,
  READ_REQUEST_TIMEOUT_MS,
  READ_RESULT_MAX_CHARS,
  type CallAttachmentImageMetaMessage,
  type CallAttachmentManifest,
  type CallAttachmentReadResultMessage,
} from '../core/attachmentProtocol.ts';
import {
  rememberAttachmentImage,
  rememberAttachmentManifest,
  removeAttachmentImage,
} from './attachmentContext.ts';

type SpikeEvent = { type: string } & Record<string, unknown>;
type ReadResultPayload = Omit<CallAttachmentReadResultMessage, 'type' | 'requestId' | 'attachmentId'>;
type ByteStreamHandlerLike = (reader: {
  info: { attributes?: Record<string, string> };
  readAll: () => Promise<Array<Uint8Array>>;
  close: () => Promise<void>;
}, participantInfo: { identity: string }) => void | Promise<void>;

export type AttachmentBridgeDeps = {
  ctx: JobContext;
  getAgent: () => Agent | null;
  isUserSpeaking: () => boolean;
  isAgentSpeaking: () => boolean;
  generateReply: (instructions: string) => Promise<unknown>;
  emit: (event: SpikeEvent) => void;
  logger: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
};

const IMAGE_REPLY_INSTRUCTIONS =
  '用户刚在电话里发来一张图片，图片对你直接可见。请简短自然地回应你看到的内容，然后等用户继续说明来意。'
  + '不要提到后台、任务、文件路径、权限或工具。';

function formatReadResult(manifest: CallAttachmentManifest, result: ReadResultPayload): string {
  if (!result.ok) {
    return `读取失败：${result.error || result.note || '未知原因'}。当前可读附件：${manifest.fileName}（attachmentId: ${manifest.attachmentId}）。`;
  }
  const returned = result.returned || [];
  if (!returned.length) {
    return `${manifest.fileName} 没有返回内容：${result.note || '该范围没有文本。'}`;
  }
  // 仅约束「一次 tool result」的防滥用上限（真实片段预算由 client 按
  // READ_RESULT_MAX_CHARS 执行）；完整文档存储在 client 侧，不受任何截断。
  const body = returned
    .map((chunk) => `[第${chunk.page ?? '?'}页 · 段${chunk.index}] ${chunk.text}`)
    .join('\n\n')
    .slice(0, READ_RESULT_MAX_CHARS * 2);
  return `来自 ${manifest.fileName} 的相关片段（完整文档共 ${result.totalChunks ?? '?'} 段）：

${body}${result.note ? `\n\n（${result.note}）` : ''}`;
}

export type AttachmentBridge = {
  /** 处理 client → worker 的 'rt.attachment' 控制消息（已 JSON 解析）。 */
  handleRendererMessage: (message: unknown) => void;
  /**
   * 注册 room 的 byte stream handler（图片字节流接收）。必须在
   * session.start 后调用一次。
   */
  registerByteStreamHandler: () => void;
  /** read_call_attachment 工具入口。 */
  readAttachment: (attachmentId: string, query?: string, page?: number) => Promise<string>;
  /** 用户 final transcript 到达：取消图片的自动回复窗口（合并为用户回合）。 */
  noteUserTurnStarted: () => void;
  /** LLM 错误到达：仅当明确 vision unsupported 时降级。返回是否处理。 */
  notifySessionError: (error: unknown) => Promise<boolean>;
  dispose: () => void;
};

export function createAttachmentBridge(deps: AttachmentBridgeDeps): AttachmentBridge {
  const manifests = new Map<string, CallAttachmentManifest>();
  // meta 信封 → 待接收的图片字节流。byte stream 只在 meta 已到达时被接受。
  const imageTransfers = new Map<string, {
    meta: CallAttachmentImageMetaMessage;
    bytes: Array<Uint8Array> | null;
    received: number;
  }>();
  const readRequests = new Map<string, {
    resolve: (result: ReadResultPayload) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const visionPending = new Set<string>();
  let sessionCallSessionId: string | null = null;
  let imageReplyTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const publishToRenderer = (message: Record<string, unknown>) => {
    try {
      deps.ctx.room.localParticipant?.publishData(
        new TextEncoder().encode(JSON.stringify(message)),
        { reliable: true, topic: 'sully.attachment' },
      );
    } catch {
      /* client 可能尚未连接；依赖上层超时与重试语义 */
    }
  };

  const clearImageReplyTimer = () => {
    if (imageReplyTimer) {
      clearTimeout(imageReplyTimer);
      imageReplyTimer = null;
    }
  };

  const scheduleImageReply = () => {
    clearImageReplyTimer();
    imageReplyTimer = setTimeout(() => {
      imageReplyTimer = null;
      if (disposed || deps.isUserSpeaking() || deps.isAgentSpeaking()) return;
      void deps.generateReply(IMAGE_REPLY_INSTRUCTIONS).catch((error) => {
        deps.logger.warn({ err: String(error) }, '[rt-attachment] image pending reply failed');
      });
    }, IMAGE_PENDING_REPLY_WINDOW_MS);
  };

  const acceptCallSessionId = (candidate: string): boolean => {
    if (!CALL_SESSION_ID_RE.test(candidate)) return false;
    if (!sessionCallSessionId) sessionCallSessionId = candidate;
    return sessionCallSessionId === candidate;
  };

  const handleManifestMessage = async (message: { manifest?: CallAttachmentManifest; restore?: boolean }) => {
    const manifest = message.manifest;
    if (!manifest || !CALL_ATTACHMENT_ID_RE.test(String(manifest.attachmentId || ''))) return;
    if (!acceptCallSessionId(String(manifest.callSessionId || ''))) return;
    if (!['image', 'pdf', 'text'].includes(manifest.kind)) return;
    // analysisSummary / documentOverview 的注入预算在 attachmentContext 层
    // 执行；这里只保留 wire 层已裁剪的原文引用。
    manifests.set(manifest.attachmentId, manifest);
    if (manifest.kind === 'image') {
      // 图片的上下文引用就是图片消息本身；manifest 只用于 reconnect 重绑定。
      return;
    }
    const agent = deps.getAgent();
    if (!agent) return;
    try {
      const outcome = await rememberAttachmentManifest(agent, manifest);
      deps.emit({ type: 'attachment.manifest_registered', attachmentId: manifest.attachmentId, outcome });
      deps.logger.info({ attachmentId: manifest.attachmentId, outcome }, '[rt-attachment] attachment manifest registered');
    } catch (error) {
      deps.logger.warn({ err: String(error) }, '[rt-attachment] manifest registration failed');
    }
  };

  const finishImageTransfer = async (transferId: string) => {
    const transfer = imageTransfers.get(transferId);
    if (!transfer) return;
    imageTransfers.delete(transferId);
    const { meta } = transfer;
    if (!transfer.bytes || !transfer.bytes.length) {
      deps.logger.warn({ attachmentId: meta.attachmentId }, '[rt-attachment] image stream empty, discarded');
      return;
    }
    const total = transfer.bytes.reduce((sum, part) => sum + part.byteLength, 0);
    // byteLength 不匹配 = 传输不完整/损坏，宁可丢弃也不生成坏图。
    if (total !== meta.byteLength) {
      deps.logger.warn({ attachmentId: meta.attachmentId, expected: meta.byteLength, actual: total }, '[rt-attachment] image byte length mismatch, discarded');
      return;
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of transfer.bytes) {
      merged.set(part, offset);
      offset += part.byteLength;
    }
    const dataUrl = `data:${meta.mimeType};base64,${Buffer.from(merged).toString('base64')}`;
    const agent = deps.getAgent();
    if (!agent) return;
    const manifest = manifests.get(meta.attachmentId);
    try {
      const added = await rememberAttachmentImage(agent, {
        attachmentId: meta.attachmentId,
        fileName: manifest?.fileName || '图片附件',
        mimeType: meta.mimeType,
        dataUrl,
      });
      if (!added) return;
      visionPending.add(meta.attachmentId);
      deps.emit({ type: 'attachment.image_received', attachmentId: meta.attachmentId, restore: meta.restore });
      deps.logger.info({ attachmentId: meta.attachmentId, restore: meta.restore }, '[rt-attachment] image entered model context');
      if (!meta.restore) scheduleImageReply();
    } catch (error) {
      deps.logger.warn({ err: String(error) }, '[rt-attachment] image context registration failed');
    }
  };

  const handleImageMeta = (message: Record<string, unknown>) => {
    const meta = message as unknown as CallAttachmentImageMetaMessage;
    if (!CALL_ATTACHMENT_ID_RE.test(String(meta.attachmentId || ''))) return;
    if (!acceptCallSessionId(String(meta.callSessionId || ''))) return;
    if (typeof meta.byteLength !== 'number' || meta.byteLength <= 0) return;
    if (imageTransfers.has(meta.attachmentId)) return; // 重复 meta（重发）忽略
    imageTransfers.set(meta.attachmentId, { meta, bytes: null, received: 0 });
    // 孤儿 meta 兜底：字节流迟迟不来（>=10s）就丢弃，避免 map 泄漏。
    setTimeout(() => {
      const pending = imageTransfers.get(meta.attachmentId);
      if (pending && pending.meta === meta) {
        imageTransfers.delete(meta.attachmentId);
        deps.logger.warn({ attachmentId: meta.attachmentId }, '[rt-attachment] image meta expired without byte stream');
      }
    }, READ_REQUEST_TIMEOUT_MS * 2);
  };

  const handleReadResult = (message: Record<string, unknown>) => {
    const requestId = String(message.requestId || '');
    const pending = readRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    readRequests.delete(requestId);
    pending.resolve({
      ok: message.ok === true,
      totalChunks: typeof message.totalChunks === 'number' ? message.totalChunks : undefined,
      returned: Array.isArray(message.returned) ? (message.returned as CallAttachmentReadResultMessage['returned']) : [],
      note: typeof message.note === 'string' ? message.note.slice(0, 300) : undefined,
      error: typeof message.error === 'string' ? message.error.slice(0, 300) : undefined,
    });
  };

  const handleRendererMessage = (raw: unknown) => {
    if (disposed) return;
    if (!raw || typeof raw !== 'object') return;
    const message = raw as Record<string, unknown>;
    switch (message.type) {
      case 'attachment.manifest':
        void handleManifestMessage(message as { manifest?: CallAttachmentManifest; restore?: boolean });
        return;
      case 'attachment.image.meta':
        handleImageMeta(message);
        return;
      case 'attachment.read.result':
        handleReadResult(message);
        return;
      default:
        return;
    }
  };

  const registerByteStreamHandler = () => {
    const handler: ByteStreamHandlerLike = async (reader) => {
      if (disposed) {
        await reader.close().catch(() => undefined);
        return;
      }
      try {
        const attachmentId = String(reader.info.attributes?.attachmentId || '');
        if (!CALL_ATTACHMENT_ID_RE.test(attachmentId)) {
          await reader.close().catch(() => undefined);
          return;
        }
        const transfer = imageTransfers.get(attachmentId);
        if (!transfer || transfer.bytes) {
          // 没有 meta 的流不可信（协议要求 meta 先行）；重复流丢弃。
          deps.logger.warn({ attachmentId, hasMeta: !!transfer }, '[rt-attachment] unexpected image byte stream, discarded');
          await reader.close().catch(() => undefined);
          return;
        }
        transfer.bytes = await reader.readAll();
        await finishImageTransfer(attachmentId);
      } catch (error) {
        deps.logger.warn({ err: String(error) }, '[rt-attachment] image byte stream failed');
      }
    };
    (deps.ctx.room as unknown as {
      registerByteStreamHandler?: (topic: string, handler: ByteStreamHandlerLike) => void;
    }).registerByteStreamHandler?.(IMAGE_STREAM_TOPIC, handler);
  };

  const readAttachment = async (attachmentId: string, query?: string, page?: number): Promise<string> => {
    const manifest = manifests.get(attachmentId);
    if (!manifest) {
      const known = [...manifests.values()].map((entry) => `${entry.fileName}（${entry.attachmentId}）`).join('；') || '（无）';
      return `本次电话没有这个 attachmentId。当前已注册的附件：${known}`;
    }
    if (manifest.kind === 'image') return '这是一张图片，已经直接进入你的视觉上下文，无法用文本方式读取，请直接看图回答。';
    const requestId = `read-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await new Promise<ReadResultPayload>((resolve) => {
      const timer = setTimeout(() => {
        readRequests.delete(requestId);
        resolve({ ok: false, error: '读取附件超时' });
      }, READ_REQUEST_TIMEOUT_MS);
      readRequests.set(requestId, { resolve, timer });
      publishToRenderer({
        type: 'attachment.read.request',
        requestId,
        attachmentId,
        callSessionId: manifest.callSessionId,
        ...(query?.trim() ? { query: query.trim().slice(0, 200) } : {}),
        ...(typeof page === 'number' && Number.isFinite(page) && page >= 1 ? { page: Math.floor(page) } : {}),
      });
    });
    return formatReadResult(manifest, result);
  };

  const noteUserTurnStarted = () => {
    // 用户开口/出字：图片等待合并进用户回合，取消自动回复窗口。
    if (imageReplyTimer) clearImageReplyTimer();
  };

  const notifySessionError = async (error: unknown): Promise<boolean> => {
    if (visionPending.size === 0) return false;
    const candidate = error as { type?: string; code?: string; message?: string; status?: number; body?: string } | null;
    if (!isVisionUnsupportedError({
      type: typeof candidate?.type === 'string' ? candidate.type : undefined,
      code: typeof candidate?.code === 'string' ? candidate.code : undefined,
      message: typeof candidate?.message === 'string' ? candidate.message : undefined,
      body: typeof candidate?.body === 'string' ? candidate.body : undefined,
      status: typeof candidate?.status === 'number' ? candidate.status : undefined,
    })) return false;
    const ids = [...visionPending];
    visionPending.clear();
    const agent = deps.getAgent();
    for (const attachmentId of ids) {
      if (agent) await removeAttachmentImage(agent, attachmentId).catch(() => undefined);
      const message = String(candidate?.message || '当前模型不支持直接看图').slice(0, 240);
      deps.emit({ type: 'attachment.vision_unsupported', attachmentId, message });
      publishToRenderer({ type: 'attachment.vision_unsupported', attachmentId, message });
      deps.logger.warn({ attachmentId, message }, '[rt-attachment] vision unsupported, image removed from context');
    }
    return true;
  };

  const dispose = () => {
    disposed = true;
    clearImageReplyTimer();
    for (const [requestId, pending] of readRequests) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: '通话已结束' });
      readRequests.delete(requestId);
    }
    imageTransfers.clear();
    manifests.clear();
    visionPending.clear();
  };

  return { handleRendererMessage, registerByteStreamHandler, readAttachment, noteUserTurnStarted, notifySessionError, dispose };
}

export const ATTACHMENT_CHANNEL_PAYLOAD_LIMIT_BYTES = CALL_ATTACHMENT_MAX_PAYLOAD_BYTES + 10_000;

