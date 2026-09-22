import { DB } from './db';
import {
  COMPANION_BACKEND_CONFIG_CHANGED,
  ackCompanionOutbox,
  loadCompanionBackendConfig,
  notifyCompanionUserReply,
  pullCompanionOutbox,
  reportCompanionDeliveryIntentResult,
  syncCompanionCharacter,
  type CompanionOutboxItem,
} from './companionBackendClient';
import { buildDeliveryConfirmationCard, executeCharacterDeliveryIntent } from './deliveryAutonomy';

export const COMPANION_USER_MESSAGE_SAVED = 'sully:companion-user-message-saved';

const POLL_MS = 60_000;
const RETRY_MS = 15_000;
const SNAPSHOT_REFRESH_MS = 6 * 60 * 60_000;
const replyTimers = new Map<string, ReturnType<typeof setTimeout>>();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let initialized = false;
let lastSnapshotSyncAt = 0;

const schedule = (delay: number) => {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void poll(), delay);
};

const deliver = async (item: CompanionOutboxItem): Promise<boolean> => {
  const char = await DB.getCharacter(item.charId);
  if (!char) return false;
  await DB.saveMessageOnce(`companion:${item.id}`, {
    charId: item.charId,
    role: 'assistant',
    type: 'text',
    content: item.content,
    timestamp: item.createdAt,
    metadata: {
      ...item.metadata,
      source: 'companion-backend',
      companionHeartbeat: true,
    },
  });
  const deliveryIntent = item.metadata.deliveryOrderIntent;
  let notificationBody = item.content;
  if (deliveryIntent?.type === 'delivery_order') {
    const result = await executeCharacterDeliveryIntent(char, {
      ...deliveryIntent,
      // 后端 outbox 主键才是信任边界内的稳定幂等键，忽略载荷里可能伪造的值。
      intentId: item.id,
    });
    if (result.status === 'placed') {
      const card = buildDeliveryConfirmationCard(result.order);
      await DB.saveMessageOnce(`companion-delivery-result:${item.id}`, {
        charId: item.charId,
        role: 'assistant',
        type: 'html_card',
        content: card.preview,
        timestamp: item.createdAt + 1,
        metadata: {
          source: 'companion-backend',
          companionHeartbeat: true,
          htmlSource: card.html,
          htmlTextPreview: card.preview,
          commerceOrderId: result.order.id,
          deliveryIntentId: item.id,
        },
      });
      notificationBody = card.preview;
      await reportCompanionDeliveryIntentResult(item.id, 'placed');
    } else {
      const rejected = `[自动点单未完成：${result.reason}]`;
      await DB.saveMessageOnce(`companion-delivery-result:${item.id}`, {
        charId: item.charId,
        role: 'system',
        type: 'text',
        content: rejected,
        timestamp: item.createdAt + 1,
        metadata: { source: 'companion-backend', companionHeartbeat: true, deliveryIntentId: item.id },
      });
      notificationBody = rejected;
      await reportCompanionDeliveryIntentResult(item.id, 'rejected');
    }
  }
  await ackCompanionOutbox(item.id);
  window.dispatchEvent(new CustomEvent('active-msg-received', {
    detail: {
      charId: char.id,
      charName: char.name,
      body: notificationBody,
      avatarUrl: char.avatar,
      sentAt: item.createdAt,
    },
  }));
  return true;
};

const poll = async () => {
  if (running) return;
  const config = loadCompanionBackendConfig();
  if (!config.enabled || !config.baseUrl || !config.token) return;
  running = true;
  try {
    if (Date.now() - lastSnapshotSyncAt >= SNAPSHOT_REFRESH_MS) {
      await syncAllCharacters();
      lastSnapshotSyncAt = Date.now();
    }
    const items = await pullCompanionOutbox();
    for (const item of items) {
      try { await deliver(item); } catch (error) {
        console.warn('[CompanionBackend] 主动消息落库失败，保留后端待重试', error);
      }
    }
    schedule(POLL_MS);
  } catch (error) {
    console.warn('[CompanionBackend] 拉取主动消息失败', error);
    schedule(RETRY_MS);
  } finally {
    running = false;
  }
};

const syncAllCharacters = async () => {
  const config = loadCompanionBackendConfig();
  if (!config.enabled || !config.baseUrl || !config.token) return;
  const chars = await DB.getAllCharacters();
  for (const char of chars) {
    try { await syncCompanionCharacter(char); } catch (error) {
      console.warn(`[CompanionBackend] 角色 ${char.id} 快照同步失败`, error);
    }
  }
};

const onUserMessageSaved = (event: Event) => {
  const charId = (event as CustomEvent<{ charId?: string }>).detail?.charId;
  if (!charId || !loadCompanionBackendConfig().enabled) return;
  const previous = replyTimers.get(charId);
  if (previous) clearTimeout(previous);
  replyTimers.set(charId, setTimeout(async () => {
    replyTimers.delete(charId);
    const char = await DB.getCharacter(charId);
    if (!char) return;
    try { await notifyCompanionUserReply(char); }
    catch (error) { console.warn('[CompanionBackend] 用户回复同步失败', error); }
  }, 800));
};

const restart = () => {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (!loadCompanionBackendConfig().enabled) return;
  lastSnapshotSyncAt = 0;
  void poll();
};

export const CompanionBackendRuntime = {
  init(): void {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;
    window.addEventListener(COMPANION_USER_MESSAGE_SAVED, onUserMessageSaved);
    window.addEventListener(COMPANION_BACKEND_CONFIG_CHANGED, restart);
    window.addEventListener('online', restart);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void poll();
    });
    restart();
  },
  pollNow(): Promise<void> { return poll(); },
};
