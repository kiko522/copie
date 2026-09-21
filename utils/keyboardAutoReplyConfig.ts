export const KEYBOARD_AUTO_REPLY_CONFIG_KEY = 'sully_keyboard_auto_reply_v1';
export const KEYBOARD_AUTO_REPLY_CONFIG_CHANGED = 'sully:keyboard-auto-reply-config-changed';
export const DEFAULT_KEYBOARD_AUTO_REPLY_DELAY_MS = 1000;
export const MAX_KEYBOARD_AUTO_REPLY_DELAY_MS = 30_000;

interface KeyboardAutoReplyConfigStore {
    enabledByConversation: Record<string, boolean>;
    delayMsByConversation: Record<string, number>;
}

export interface ConversationKeyboardAutoReplyConfig {
    enabled: boolean;
    delayMs: number;
}

const emptyStore = (): KeyboardAutoReplyConfigStore => ({
    enabledByConversation: {},
    delayMsByConversation: {},
});

export const normalizeKeyboardAutoReplyDelayMs = (value: unknown): number => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_KEYBOARD_AUTO_REPLY_DELAY_MS;
    return Math.max(0, Math.min(MAX_KEYBOARD_AUTO_REPLY_DELAY_MS, Math.round(numeric)));
};

const loadStore = (): KeyboardAutoReplyConfigStore => {
    if (typeof localStorage === 'undefined') return emptyStore();
    try {
        const raw = JSON.parse(localStorage.getItem(KEYBOARD_AUTO_REPLY_CONFIG_KEY) || '{}');
        const enabledByConversation: Record<string, boolean> = {};
        const delayMsByConversation: Record<string, number> = {};
        if (raw?.enabledByConversation && typeof raw.enabledByConversation === 'object') {
            for (const [id, enabled] of Object.entries(raw.enabledByConversation)) {
                if (enabled === true) enabledByConversation[id] = true;
            }
        }
        if (raw?.delayMsByConversation && typeof raw.delayMsByConversation === 'object') {
            for (const [id, delay] of Object.entries(raw.delayMsByConversation)) {
                delayMsByConversation[id] = normalizeKeyboardAutoReplyDelayMs(delay);
            }
        }
        return { enabledByConversation, delayMsByConversation };
    } catch {
        return emptyStore();
    }
};

const saveStore = (store: KeyboardAutoReplyConfigStore): void => {
    try {
        localStorage.setItem(KEYBOARD_AUTO_REPLY_CONFIG_KEY, JSON.stringify(store));
        window.dispatchEvent(new Event(KEYBOARD_AUTO_REPLY_CONFIG_CHANGED));
    } catch {
        // 存储不可用时不阻断聊天。
    }
};

export const getConversationKeyboardAutoReplyConfig = (conversationId: string): ConversationKeyboardAutoReplyConfig => {
    const store = loadStore();
    return {
        enabled: store.enabledByConversation[conversationId] === true,
        delayMs: conversationId in store.delayMsByConversation
            ? store.delayMsByConversation[conversationId]
            : DEFAULT_KEYBOARD_AUTO_REPLY_DELAY_MS,
    };
};

export const setConversationKeyboardAutoReplyEnabled = (conversationId: string, enabled: boolean): void => {
    const store = loadStore();
    if (enabled) store.enabledByConversation[conversationId] = true;
    else delete store.enabledByConversation[conversationId];
    saveStore(store);
};

export const setConversationKeyboardAutoReplyDelayMs = (conversationId: string, delayMs: number): void => {
    const store = loadStore();
    store.delayMsByConversation[conversationId] = normalizeKeyboardAutoReplyDelayMs(delayMs);
    saveStore(store);
};
