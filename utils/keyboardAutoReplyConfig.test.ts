// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_KEYBOARD_AUTO_REPLY_DELAY_MS,
    getConversationKeyboardAutoReplyConfig,
    KEYBOARD_AUTO_REPLY_CONFIG_CHANGED,
    MAX_KEYBOARD_AUTO_REPLY_DELAY_MS,
    setConversationKeyboardAutoReplyDelayMs,
    setConversationKeyboardAutoReplyEnabled,
} from './keyboardAutoReplyConfig';

beforeEach(() => localStorage.clear());

describe('per-conversation keyboard auto reply config', () => {
    it('defaults off and keeps conversations isolated', () => {
        expect(getConversationKeyboardAutoReplyConfig('a')).toEqual({
            enabled: false,
            delayMs: DEFAULT_KEYBOARD_AUTO_REPLY_DELAY_MS,
        });
        setConversationKeyboardAutoReplyEnabled('a', true);
        setConversationKeyboardAutoReplyDelayMs('a', 2500);
        expect(getConversationKeyboardAutoReplyConfig('a')).toEqual({ enabled: true, delayMs: 2500 });
        expect(getConversationKeyboardAutoReplyConfig('b')).toEqual({ enabled: false, delayMs: 1000 });
    });

    it('clamps delay and broadcasts live changes', () => {
        const listener = vi.fn();
        window.addEventListener(KEYBOARD_AUTO_REPLY_CONFIG_CHANGED, listener);
        setConversationKeyboardAutoReplyDelayMs('a', -100);
        expect(getConversationKeyboardAutoReplyConfig('a').delayMs).toBe(0);
        setConversationKeyboardAutoReplyDelayMs('a', 99_999);
        expect(getConversationKeyboardAutoReplyConfig('a').delayMs).toBe(MAX_KEYBOARD_AUTO_REPLY_DELAY_MS);
        expect(listener).toHaveBeenCalledTimes(2);
        window.removeEventListener(KEYBOARD_AUTO_REPLY_CONFIG_CHANGED, listener);
    });
});
