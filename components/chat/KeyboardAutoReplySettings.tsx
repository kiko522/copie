import React, { useEffect, useState } from 'react';
import {
    getConversationKeyboardAutoReplyConfig,
    KEYBOARD_AUTO_REPLY_CONFIG_CHANGED,
    MAX_KEYBOARD_AUTO_REPLY_DELAY_MS,
    setConversationKeyboardAutoReplyDelayMs,
    setConversationKeyboardAutoReplyEnabled,
} from '../../utils/keyboardAutoReplyConfig';

export default function KeyboardAutoReplySettings({ conversationId }: { conversationId: string }) {
    const [config, setConfig] = useState(() => getConversationKeyboardAutoReplyConfig(conversationId));

    useEffect(() => {
        const refresh = () => setConfig(getConversationKeyboardAutoReplyConfig(conversationId));
        refresh();
        window.addEventListener(KEYBOARD_AUTO_REPLY_CONFIG_CHANGED, refresh);
        return () => window.removeEventListener(KEYBOARD_AUTO_REPLY_CONFIG_CHANGED, refresh);
    }, [conversationId]);

    const seconds = config.delayMs / 1000;
    return (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="min-w-0">
                    <span className="block text-xs font-bold text-slate-600">收起键盘后自动回复</span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-slate-400">打完字收起键盘，TA 就会开始回；不用再点“触发回复”（只对本聊天生效）</span>
                </span>
                <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={event => setConversationKeyboardAutoReplyEnabled(conversationId, event.target.checked)}
                    className="h-5 w-5 shrink-0 cursor-pointer accent-primary"
                />
            </label>
            {config.enabled && (
                <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                    <span className="min-w-0">
                        <span className="block text-xs font-bold text-slate-600">收起后等几秒再回</span>
                        <span className="mt-1 block text-[10px] leading-relaxed text-slate-400">等待期间重新打字、打开面板或发送新消息，会重新等待。</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
                        <input
                            aria-label="收起键盘后等待秒数"
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={MAX_KEYBOARD_AUTO_REPLY_DELAY_MS / 1000}
                            step={0.5}
                            value={seconds}
                            onChange={event => {
                                const value = Number(event.target.value);
                                if (Number.isFinite(value)) setConversationKeyboardAutoReplyDelayMs(conversationId, value * 1000);
                            }}
                            className="h-8 w-16 rounded-lg border border-slate-200 bg-white text-center text-sm outline-none focus:border-primary"
                        />
                        秒
                    </span>
                </label>
            )}
        </div>
    );
}
