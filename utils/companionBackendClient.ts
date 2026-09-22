import type { CharacterProfile, Message } from '../types';
import { DB } from './db';
import { resolveCharTimeZone } from './timezone';
import { getDailyScheduleForChar } from './dailySchedule';
import { DELIVERY_STORES } from './deliveryCatalog';
import { collectRecentFoodWishSignals, getCharacterDeliveryAutonomy, type CharacterDeliveryIntent } from './deliveryAutonomy';

export interface CompanionBackendConfig {
  enabled: boolean;
  baseUrl: string;
  token: string;
}

export interface CompanionOutboxItem {
  id: string;
  charId: string;
  content: string;
  metadata: Record<string, unknown> & { deliveryOrderIntent?: CharacterDeliveryIntent };
  createdAt: number;
}

export interface CompanionExperienceSummary {
  id: string;
  kind: string;
  content: { experience?: string; thought?: string; reason?: string; message?: string };
  createdAt: number;
}

export interface CompanionCharacterStatus {
  id: string;
  name: string;
  heartbeatEnabled: boolean;
  updatedAt: number;
  nextHeartbeatAt: number | null;
  unansweredSends: number;
  recentExperiences: CompanionExperienceSummary[];
}

export interface RealtimeTokenResponse {
  token: string;
  livekitUrl: string;
  room: string;
  identity: string;
  expiresIn: number;
}

const STORAGE_KEY = 'sully_companion_backend_config_v1';
export const COMPANION_BACKEND_CONFIG_CHANGED = 'sully:companion-backend-config-changed';

export const defaultCompanionBackendConfig: CompanionBackendConfig = {
  enabled: false,
  baseUrl: '',
  token: '',
};

export const loadCompanionBackendConfig = (): CompanionBackendConfig => {
  if (typeof localStorage === 'undefined') return defaultCompanionBackendConfig;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      enabled: parsed.enabled === true,
      baseUrl: String(parsed.baseUrl || defaultCompanionBackendConfig.baseUrl).replace(/\/+$/, ''),
      token: String(parsed.token || ''),
    };
  } catch {
    return defaultCompanionBackendConfig;
  }
};

export const saveCompanionBackendConfig = (config: CompanionBackendConfig): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    enabled: config.enabled,
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    token: config.token.trim(),
  }));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(COMPANION_BACKEND_CONFIG_CHANGED));
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const config = loadCompanionBackendConfig();
  if (!config.enabled) throw new Error('个人陪伴后端尚未启用');
  if (!config.baseUrl || !config.token) throw new Error('个人陪伴后端地址或令牌未填写');
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || `陪伴后端 HTTP ${response.status}`);
  return body as T;
};

const messageText = (message: Message) => ({
  role: message.role,
  type: message.type,
  content: String(message.content || '').slice(0, 4_000),
  timestamp: message.timestamp,
});

/**
 * 上传心跳真正需要的最小角色快照。媒体、头像、工具凭据、角色级 API、完整记忆库都不上传。
 */
export const syncCompanionCharacter = async (char: CharacterProfile): Promise<void> => {
  const [messages, schedule, addresses, cards, orders] = await Promise.all([
    DB.getMessagesByCharId(char.id),
    getDailyScheduleForChar(char),
    DB.getDeliveryAddresses(),
    DB.getBankCards(char.id),
    DB.getCommerceOrders({ payerOwnerId: char.id, type: 'delivery' }),
  ]);
  const persona = [char.description, char.systemPrompt, char.worldview]
    .filter(Boolean).join('\n\n').slice(0, 40_000);
  const config = getCharacterDeliveryAutonomy(char);
  const allowedAddresses = addresses
    .filter((address) => config?.allowedAddressIds?.includes(address.id))
    .filter((address) => address.ownerId === 'user' || address.ownerId === char.id)
    .map((address) => ({ id: address.id, recipient: address.ownerId === 'user' ? 'user' : 'character', label: address.label.slice(0, 80) }));
  const selectedCardExists = Boolean(config?.cardId && cards.some((card) => card.id === config.cardId));
  const deliveryAutonomy = config?.enabled && selectedCardExists && allowedAddresses.length > 0 ? {
    enabled: true,
    paymentReady: true,
    frequency: config.frequency ?? 'normal',
    allowedAddresses,
    recentWishes: collectRecentFoodWishSignals(messages),
    recentPlacedAt: orders
      .filter((order) => order.source === 'llm' && order.paymentStatus === 'paid' && Date.now() - order.createdAt < 24 * 60 * 60_000)
      .map((order) => order.createdAt),
    catalog: DELIVERY_STORES.map((store) => ({
      id: store.id, name: store.name, category: store.category,
      minimumOrder: store.minimumOrder, deliveryFee: store.deliveryFee,
      products: store.products.map((product) => ({ id: product.id, name: product.name, price: product.price })),
    })),
  } : { enabled: false, paymentReady: false };
  await request(`/v1/characters/${encodeURIComponent(char.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: char.name,
      persona,
      interests: [],
      timeZone: resolveCharTimeZone(char) || Intl.DateTimeFormat().resolvedOptions().timeZone,
      recentMessages: messages.slice(-30).map(messageText),
      schedule: schedule ? {
        date: schedule.date,
        slots: schedule.slots.slice(0, 48).map((slot) => ({
          startTime: slot.startTime, activity: slot.activity, description: slot.description,
          location: slot.location, innerThought: slot.innerThought,
        })),
        flowNarrative: schedule.flowNarrative,
      } : null,
      deliveryAutonomy,
    }),
  });
};

/** 用户发言后立即解除“三条未回复”暂停，并把新的聊天上下文同步过去。 */
export const notifyCompanionUserReply = async (char: CharacterProfile): Promise<void> => {
  await syncCompanionCharacter(char);
  await request(`/v1/characters/${encodeURIComponent(char.id)}/user-replied`, { method: 'POST' });
};

export const pullCompanionOutbox = async (charId?: string): Promise<CompanionOutboxItem[]> => {
  const query = charId ? `?charId=${encodeURIComponent(charId)}` : '';
  const result = await request<{ items: CompanionOutboxItem[] }>(`/v1/outbox${query}`);
  return Array.isArray(result.items) ? result.items : [];
};

/** 只有调用方已成功写入现有聊天数据库后才确认，防止网络抖动导致消息丢失。 */
export const ackCompanionOutbox = async (id: string): Promise<void> => {
  await request(`/v1/outbox/${encodeURIComponent(id)}/ack`, { method: 'POST' });
};

/** 告诉 VPS 本次结构化点单意图是否通过本地最终闸门；重复上报保持幂等。 */
export const reportCompanionDeliveryIntentResult = async (id: string, status: 'placed' | 'rejected'): Promise<void> => {
  await request(`/v1/delivery-intents/${encodeURIComponent(id)}/result`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
};

export const testCompanionBackend = async (): Promise<{ ok: boolean; service: string; version: string }> => {
  const config = loadCompanionBackendConfig();
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/healthz`);
  if (!response.ok) throw new Error(`陪伴后端健康检查 HTTP ${response.status}`);
  return response.json();
};

export const testCompanionBackendAuth = async (): Promise<Record<string, unknown>> =>
  request('/v1/capabilities');

export const listCompanionCharacterStatuses = async (): Promise<CompanionCharacterStatus[]> => {
  const result = await request<{ items: CompanionCharacterStatus[] }>('/v1/characters');
  return Array.isArray(result.items) ? result.items : [];
};

export const setCompanionCharacterHeartbeatEnabled = async (charId: string, enabled: boolean): Promise<void> => {
  await request(`/v1/characters/${encodeURIComponent(charId)}/heartbeat`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
};

/**
 * 清除该角色在个人陪伴后端的测试/聊天派生状态。
 * 保留角色快照中的人设、时区和心跳开关，只清最近对话、经历、outbox 与计数。
 */
export const clearCompanionCharacterHistory = async (charId: string): Promise<{
  deletedExperiences: number;
  deletedOutbox: number;
  deletedDeliveryIntents?: number;
}> => request(`/v1/characters/${encodeURIComponent(charId)}/history`, { method: 'DELETE' });

/**
 * 由已认证的个人陪伴后端签发短期 LiveKit 入场票。
 * LiveKit API Secret 永远不会进入浏览器或仓库。
 */
export const issueRealtimeToken = async (characterId: string, identity?: string): Promise<RealtimeTokenResponse> =>
  request('/v1/realtime/token', {
    method: 'POST',
    body: JSON.stringify({ characterId, ...(identity ? { identity } : {}) }),
  });
