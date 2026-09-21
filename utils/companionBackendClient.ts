import type { CharacterProfile, Message } from '../types';
import { DB } from './db';
import { resolveCharTimeZone } from './timezone';

export interface CompanionBackendConfig {
  enabled: boolean;
  baseUrl: string;
  token: string;
}

export interface CompanionOutboxItem {
  id: string;
  charId: string;
  content: string;
  metadata: Record<string, unknown>;
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
  const messages = await DB.getMessagesByCharId(char.id);
  const persona = [char.description, char.systemPrompt, char.worldview]
    .filter(Boolean).join('\n\n').slice(0, 40_000);
  await request(`/v1/characters/${encodeURIComponent(char.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: char.name,
      persona,
      interests: [],
      timeZone: resolveCharTimeZone(char) || Intl.DateTimeFormat().resolvedOptions().timeZone,
      recentMessages: messages.slice(-30).map(messageText),
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
