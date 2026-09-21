import React, { useEffect, useMemo, useState } from 'react';
import { Microphone, MicrophoneSlash, PhoneDisconnect } from '@phosphor-icons/react';
import { issueRealtimeToken } from '../utils/companionBackendClient';
import type { RealtimeSessionInitPayload } from './client/sessionInit';
import { useRealtimeCallSession } from './client/useRealtimeCallSession';

type TranscriptItem = { id: string; role: 'user' | 'assistant'; text: string };

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
  const roomName = useMemo(
    () => `call-${props.characterId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}-${Date.now().toString(36)}`,
    [props.characterId],
  );
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
    onFatalError: () => undefined,
  });

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

      {session.phase.phase === 'error' && !session.phase.fatal && (
        <button onClick={() => void session.reconnect()} className="mb-3 rounded-xl border border-white/15 py-2 text-sm text-white/70">重新连接</button>
      )}
      <div className="flex items-center justify-center gap-7 pt-4">
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
