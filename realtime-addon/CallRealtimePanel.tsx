import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, ImageSquare, Microphone, MicrophoneSlash, Paperclip, PhoneDisconnect } from '@phosphor-icons/react';
import { issueRealtimeToken } from '../utils/companionBackendClient';
import type { RealtimeSessionInitPayload } from './client/sessionInit';
import { useRealtimeCallSession } from './client/useRealtimeCallSession';
import {
  IMAGE_MAX_TOTAL_BYTES,
  READ_RESULT_MAX_CHARS,
  READ_RESULT_MAX_CHUNKS,
  type CallAttachmentReadChunk,
  type CallAttachmentWorkerMessage,
} from './core/attachmentProtocol';

type TranscriptItem = { id: string; role: 'user' | 'assistant'; text: string };
type TextAttachment = { id: string; name: string; chunks: CallAttachmentReadChunk[] };

const createAttachmentId = () => `att-${crypto.randomUUID()}`;

const splitText = (text: string): CallAttachmentReadChunk[] => {
  const chunks: CallAttachmentReadChunk[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + 1_800, text.length);
    if (end < text.length) {
      const candidates = [text.lastIndexOf('\n', end), text.lastIndexOf('。', end), text.lastIndexOf('！', end), text.lastIndexOf('？', end)];
      const boundary = Math.max(...candidates);
      if (boundary > cursor + 500) end = boundary + 1;
    }
    const body = text.slice(cursor, end).trim();
    if (body) chunks.push({ index: chunks.length, page: null, text: body });
    cursor = end;
  }
  return chunks;
};

const overviewOf = (chunks: CallAttachmentReadChunk[]) => {
  if (!chunks.length) return '';
  const positions = [0, .25, .5, .75, 1];
  const seen = new Set<number>();
  return positions.map(position => Math.round(position * (chunks.length - 1)))
    .filter(index => !seen.has(index) && !!seen.add(index))
    .map(index => `〔段 ${index + 1}〕${chunks[index]?.text.slice(0, 900) || ''}`)
    .join('\n…\n').slice(0, 6_000);
};

const selectChunks = (chunks: CallAttachmentReadChunk[], query?: string) => {
  const terms = String(query || '').toLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
  const ranked = terms.length
    ? chunks.map((chunk, order) => ({ chunk, order, score: terms.reduce((sum, term) => sum + (chunk.text.toLowerCase().includes(term) ? 1 : 0), 0) }))
        .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.order - b.order).map(item => item.chunk)
    : chunks;
  const returned: CallAttachmentReadChunk[] = [];
  let chars = 0;
  for (const chunk of ranked) {
    if (returned.length >= READ_RESULT_MAX_CHUNKS || chars >= READ_RESULT_MAX_CHARS) break;
    returned.push(chunk);
    chars += chunk.text.length;
  }
  return returned;
};

export default function CallRealtimePanel(props: {
  characterId: string;
  characterName: string;
  accentColor: string;
  buildSessionInitPayload: () => Promise<RealtimeSessionInitPayload>;
  onUserFinal: (text: string) => void | Promise<void>;
  onAgentItem: (text: string, interrupted: boolean) => void | Promise<void>;
  onClose: () => void;
}) {
  const [active, setActive] = useState(true);
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; kind: 'image' | 'text' }>>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const textAttachmentsRef = useRef(new Map<string, TextAttachment>());
  const sessionTransportRef = useRef<{
    publish: (event: Record<string, unknown>, opts?: { maxBytes?: number }) => boolean;
    stream: (bytes: Uint8Array, meta: { mimeType: string; name: string; attributes: Record<string, string> }) => Promise<void>;
  } | null>(null);
  const roomName = useMemo(
    () => `call-${props.characterId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}-${Date.now().toString(36)}`,
    [props.characterId],
  );
  const handleAttachmentMessage = useCallback((raw: unknown) => {
    const message = raw as CallAttachmentWorkerMessage;
    if (message?.type === 'attachment.vision_unsupported') {
      setAttachmentError(`当前主模型不支持直接看图：${message.message || '请更换支持视觉的模型'}`);
      return;
    }
    if (message?.type !== 'attachment.read.request') return;
    const document = textAttachmentsRef.current.get(message.attachmentId);
    const returned = document ? selectChunks(document.chunks, message.query) : [];
    sessionTransportRef.current?.publish({
      type: 'attachment.read.result',
      requestId: message.requestId,
      attachmentId: message.attachmentId,
      ok: !!document && returned.length > 0,
      totalChunks: document?.chunks.length || 0,
      returned,
      ...(!document ? { error: '文本附件不存在或已经随通话结束清除' } : returned.length ? {} : { note: '未找到相关文本，可更换关键词继续读取。' }),
    }, { maxBytes: 60_000 });
  }, []);

  const session = useRealtimeCallSession({
    enabled: true,
    active,
    roomName,
    getToken: () => issueRealtimeToken(props.characterId, `phone-${Date.now().toString(36)}`),
    buildSessionInitPayload: props.buildSessionInitPayload,
    onUserFinal: text => {
      setItems(previous => [...previous, { id: `u-${Date.now()}`, role: 'user', text }]);
      void props.onUserFinal(text);
    },
    onAgentItem: (text, interrupted) => {
      if (!text.trim()) return;
      setItems(previous => [...previous, { id: `a-${Date.now()}`, role: 'assistant', text }]);
      void props.onAgentItem(text, interrupted);
    },
    onAttachmentChannelMessage: handleAttachmentMessage,
    onFatalError: () => undefined,
  });
  sessionTransportRef.current = { publish: session.publishControlEvent, stream: session.streamAttachmentBytes };

  useEffect(() => {
    if (session.phase.phase === 'ready' || session.phase.phase === 'listening') {
      void session.setMicEnabled(true);
    }
  }, [session.phase.phase]);

  const phaseLabel = session.phase.phase === 'connecting' ? '正在接通实时语音…'
    : session.phase.phase === 'speaking' ? `${props.characterName} 正在说话`
    : session.phase.phase === 'thinking' ? `${props.characterName} 正在思考`
    : session.phase.phase === 'error' ? session.phase.message
    : session.phase.phase === 'ready' || session.phase.phase === 'listening' ? '正在聆听'
    : '准备中';

  const hangup = async () => {
    setActive(false);
    await session.stop();
    props.onClose();
  };

  const sendAttachment = async (file: File) => {
    setAttachmentError('');
    const transport = sessionTransportRef.current;
    if (!transport || (session.phase.phase !== 'ready' && session.phase.phase !== 'listening' && session.phase.phase !== 'thinking' && session.phase.phase !== 'speaking')) {
      throw new Error('实时通话尚未接通');
    }
    const attachmentId = createAttachmentId();
    if (file.type.startsWith('image/')) {
      if (file.size <= 0 || file.size > IMAGE_MAX_TOTAL_BYTES) throw new Error('图片必须小于 8 MB');
      const manifest = { attachmentId, callSessionId: roomName, kind: 'image', fileName: file.name.slice(0, 180), mimeType: file.type, byteLength: file.size };
      if (!transport.publish({ type: 'attachment.manifest', manifest, restore: false })) throw new Error('图片清单发送失败');
      if (!transport.publish({ type: 'attachment.image.meta', attachmentId, callSessionId: roomName, mimeType: file.type, byteLength: file.size, restore: false })) throw new Error('图片元数据发送失败');
      await transport.stream(new Uint8Array(await file.arrayBuffer()), {
        mimeType: file.type,
        name: file.name,
        attributes: { attachmentId, callSessionId: roomName, restore: '0' },
      });
      setAttachments(previous => [...previous, { id: attachmentId, name: file.name, kind: 'image' }]);
      return;
    }
    if (!(file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name))) throw new Error('只支持图片或 UTF-8 文本文件');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error('文本文件必须使用 UTF-8 编码'); }
    if (!text.trim()) throw new Error('文本文件是空的');
    const chunks = splitText(text);
    textAttachmentsRef.current.set(attachmentId, { id: attachmentId, name: file.name, chunks });
    const manifest = {
      attachmentId,
      callSessionId: roomName,
      kind: 'text',
      fileName: file.name.slice(0, 180),
      mimeType: file.type || 'text/plain',
      byteLength: file.size,
      chunkCount: chunks.length,
      documentOverview: overviewOf(chunks),
    };
    if (!transport.publish({ type: 'attachment.manifest', manifest, restore: false })) throw new Error('文本清单发送失败');
    setAttachments(previous => [...previous, { id: attachmentId, name: file.name, kind: 'text' }]);
  };

  const chooseAttachment = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void sendAttachment(file).catch(error => setAttachmentError(error?.message || '附件发送失败'));
    };
    input.click();
  };

  return (
    <div className="h-full w-full bg-[#0a0613] text-white flex flex-col px-5" style={{ paddingTop: 'max(2.5rem, var(--safe-top))', paddingBottom: 'max(1.5rem, var(--safe-bottom))' }}>
      <div className="text-center">
        <div className="text-[10px] tracking-[0.22em] text-white/35">LIVEKIT REALTIME</div>
        <h1 className="mt-2 text-2xl font-serif italic">{props.characterName}</h1>
        <div className="mt-2 text-xs" style={{ color: session.phase.phase === 'error' ? '#fb7185' : props.accentColor }}>{phaseLabel}</div>
      </div>

      <div className="mt-6 flex-1 min-h-0 overflow-y-auto space-y-2.5">
        {!items.length && <div className="py-14 text-center text-sm text-white/30">接通后直接说话就可以了</div>}
        {items.map(item => (
          <div key={item.id} className={`rounded-2xl border border-white/10 px-3.5 py-2.5 text-sm leading-relaxed ${item.role === 'user' ? 'ml-7 bg-white/[0.08]' : 'mr-7 bg-white/[0.035]'}`}>
            <div className="mb-1 text-[10px] text-white/35">{item.role === 'user' ? '你' : props.characterName}</div>
            {item.text}
          </div>
        ))}
      </div>

      {!!attachments.length && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {attachments.map(item => (
            <span key={item.id} className="shrink-0 flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[10px] text-white/60">
              {item.kind === 'image' ? <ImageSquare size={12} /> : <FileText size={12} />}{item.name}
            </span>
          ))}
        </div>
      )}
      {attachmentError && <div className="mb-2 text-center text-[11px] text-rose-300">{attachmentError}</div>}

      {session.phase.phase === 'error' && !session.phase.fatal && (
        <button onClick={() => void session.reconnect()} className="mb-3 rounded-xl border border-white/15 py-2 text-sm text-white/70">重新连接</button>
      )}
      <div className="flex items-center justify-center gap-7 pt-4">
        <button onClick={chooseAttachment} className="h-12 w-12 rounded-full border border-white/15 bg-white/[0.06] flex items-center justify-center" aria-label="发送图片或文本附件">
          <Paperclip size={20} />
        </button>
        <button
          onClick={() => void session.setMicEnabled(!session.micEnabled)}
          className="h-14 w-14 rounded-full border border-white/15 bg-white/[0.08] flex items-center justify-center"
          aria-label={session.micEnabled ? '关闭麦克风' : '打开麦克风'}
        >
          {session.micEnabled ? <Microphone size={23} /> : <MicrophoneSlash size={23} />}
        </button>
        <button onClick={() => void hangup()} className="h-16 w-16 rounded-full bg-rose-500 flex items-center justify-center" aria-label="挂断">
          <PhoneDisconnect size={27} weight="fill" />
        </button>
      </div>
    </div>
  );
}
