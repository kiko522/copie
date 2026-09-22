import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { BankCard, CharacterDeliveryFrequency, CharacterProfile, DeliveryAddress } from '../../types';
import { DB } from '../../utils/db';
import { getCharacterDeliveryAutonomy } from '../../utils/deliveryAutonomy';
import {
  listCompanionCharacterStatuses,
  loadCompanionBackendConfig,
  saveCompanionBackendConfig,
  setCompanionCharacterHeartbeatEnabled,
  syncCompanionCharacter,
  testCompanionBackend,
  testCompanionBackendAuth,
  type CompanionBackendConfig,
  type CompanionCharacterStatus,
} from '../../utils/companionBackendClient';

interface Props {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  characters: CharacterProfile[];
  updateCharacter: (id: string, updates: Partial<CharacterProfile> | ((prev: CharacterProfile) => Partial<CharacterProfile>)) => void;
}

const CompanionBackendPanel: React.FC<Props> = ({ addToast, characters, updateCharacter }) => {
  const [config, setConfig] = useState<CompanionBackendConfig>(() => loadCompanionBackendConfig());
  const [testing, setTesting] = useState(false);
  const [statuses, setStatuses] = useState<CompanionCharacterStatus[]>([]);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [updatingCharId, setUpdatingCharId] = useState('');
  const [cardsByChar, setCardsByChar] = useState<Record<string, BankCard[]>>({});
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([]);
  const [editingDeliveryCharId, setEditingDeliveryCharId] = useState('');
  const [deliveryDraft, setDeliveryDraft] = useState<{ enabled: boolean; cardId: string; allowedAddressIds: string[]; frequency: CharacterDeliveryFrequency }>({
    enabled: false, cardId: '', allowedAddressIds: [], frequency: 'normal',
  });

  useEffect(() => {
    void Promise.all([
      DB.getDeliveryAddresses(),
      Promise.all(characters.map(async (char) => [char.id, await DB.getBankCards(char.id)] as const)),
    ]).then(([nextAddresses, cardEntries]) => {
      setAddresses(nextAddresses);
      setCardsByChar(Object.fromEntries(cardEntries));
    }).catch(() => {
      setAddresses([]);
      setCardsByChar({});
    });
  }, [characters]);

  const charactersById = useMemo(() => new Map(characters.map((char) => [char.id, char])), [characters]);

  const refreshStatuses = useCallback(async () => {
    const saved = loadCompanionBackendConfig();
    if (!saved.enabled || !saved.baseUrl || !saved.token) {
      setStatuses([]);
      return;
    }
    setLoadingStatuses(true);
    setStatusError('');
    try {
      setStatuses(await listCompanionCharacterStatuses());
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : '角色心跳状态读取失败');
    } finally {
      setLoadingStatuses(false);
    }
  }, []);

  useEffect(() => { void refreshStatuses(); }, [refreshStatuses]);

  const update = <K extends keyof CompanionBackendConfig>(key: K, value: CompanionBackendConfig[K]) =>
    setConfig(current => ({ ...current, [key]: value }));

  const save = () => {
    saveCompanionBackendConfig(config);
    addToast(config.enabled ? '个人陪伴后端已保存并开始同步' : '个人陪伴后端已关闭', 'success');
    if (config.enabled) void refreshStatuses();
    else setStatuses([]);
  };

  const test = async () => {
    setTesting(true);
    try {
      saveCompanionBackendConfig(config);
      await testCompanionBackend();
      if (config.enabled) await testCompanionBackendAuth();
      if (config.enabled) await refreshStatuses();
      addToast(config.enabled ? '后端连接与令牌验证成功' : '后端健康检查成功；启用后可继续验证令牌', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '后端连接失败', 'error');
    } finally { setTesting(false); }
  };

  const toggleCharacter = async (status: CompanionCharacterStatus) => {
    const enabled = !status.heartbeatEnabled;
    setUpdatingCharId(status.id);
    setStatusError('');
    try {
      await setCompanionCharacterHeartbeatEnabled(status.id, enabled);
      setStatuses(current => current.map(item => item.id === status.id
        ? { ...item, heartbeatEnabled: enabled, nextHeartbeatAt: enabled ? Date.now() + 60_000 : null }
        : item));
      addToast(`${status.name} 的角色心跳已${enabled ? '开启' : '关闭'}`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '角色心跳设置失败';
      setStatusError(message);
      addToast(message, 'error');
    } finally {
      setUpdatingCharId('');
    }
  };

  const formatTime = (value: number | null) => value
    ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value)
    : '已暂停';

  const experienceText = (status: CompanionCharacterStatus) => {
    const latest = status.recentExperiences.at(-1);
    if (!latest) return '还没有经历记录';
    return latest.content.experience || latest.content.thought || latest.content.reason || latest.content.message || latest.kind;
  };

  const beginDeliveryEdit = (char: CharacterProfile) => {
    const saved = getCharacterDeliveryAutonomy(char);
    setEditingDeliveryCharId(char.id);
    setDeliveryDraft({
      enabled: saved?.enabled === true,
      cardId: saved?.cardId ?? '',
      allowedAddressIds: saved?.allowedAddressIds ?? [],
      frequency: saved?.frequency ?? 'normal',
    });
  };

  const saveDelivery = (char: CharacterProfile) => {
    const validCard = (cardsByChar[char.id] ?? []).some((card) => card.id === deliveryDraft.cardId);
    const allowedAddressIds = deliveryDraft.allowedAddressIds.filter((id) => addresses.some((address) =>
      address.id === id && (address.ownerId === 'user' || address.ownerId === char.id)));
    if (deliveryDraft.enabled && !validCard) {
      addToast(`请先给 ${char.name} 选择一张角色自己的银行卡`, 'error');
      return;
    }
    if (deliveryDraft.enabled && allowedAddressIds.length === 0) {
      addToast('至少选择一个允许使用的已知地址', 'error');
      return;
    }
    const deliveryAutonomy = {
      enabled: deliveryDraft.enabled,
      cardId: deliveryDraft.cardId || undefined,
      allowedAddressIds,
      frequency: deliveryDraft.frequency,
    };
    updateCharacter(char.id, { deliveryAutonomy });
    if (loadCompanionBackendConfig().enabled) {
      void syncCompanionCharacter({ ...char, deliveryAutonomy }).catch((error) => {
        addToast(error instanceof Error ? `本地已保存，但同步 VPS 失败：${error.message}` : '本地已保存，但同步 VPS 失败', 'error');
      });
    }
    setEditingDeliveryCharId('');
    addToast(deliveryDraft.enabled ? `${char.name} 的心跳自主点外卖已开启` : `${char.name} 的心跳自主点外卖已关闭`, 'success');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        连接你自己的 VPS，让全部角色在网页关闭时继续生活、读取热搜并按需主动联系。聊天 API 密钥与媒体不会上传；这里只保存后端地址和访问令牌。
      </p>
      <label className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
        <span className="text-[11px] font-medium text-slate-600">启用个人陪伴后端</span>
        <input type="checkbox" checked={config.enabled} onChange={event => update('enabled', event.target.checked)} className="h-4 w-4 accent-teal-500" />
      </label>
      <label className="block">
        <span className="text-[10px] text-slate-500">后端地址</span>
        <input value={config.baseUrl} onChange={event => update('baseUrl', event.target.value)} placeholder="https://api.example.com" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700" />
      </label>
      <label className="block">
        <span className="text-[10px] text-slate-500">访问令牌</span>
        <input type="password" value={config.token} onChange={event => update('token', event.target.value)} autoComplete="off" placeholder="部署时生成的 BACKEND_TOKEN" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={save} className="rounded-xl bg-teal-500 py-2.5 text-xs font-bold text-white hover:bg-teal-600">保存</button>
        <button type="button" disabled={testing || !config.baseUrl.trim()} onClick={() => void test()} className="rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-600 disabled:opacity-50">
          {testing ? '检查中…' : '测试连接'}
        </button>
      </div>
      <p className="text-[10px] text-slate-400 leading-relaxed">当前策略：02:00–08:30 免打扰；连续三条主动消息未回复后暂停，直到你再次发言。</p>

      {config.enabled && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-700">角色心跳状态</p>
              <p className="text-[10px] text-slate-400">关闭只会暂停该角色，不会删除经历。</p>
            </div>
            <button type="button" onClick={() => void refreshStatuses()} disabled={loadingStatuses}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-500 disabled:opacity-50">
              {loadingStatuses ? '刷新中…' : '刷新'}
            </button>
          </div>

          {statusError && <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[10px] text-rose-600">{statusError}</p>}
          {!loadingStatuses && !statusError && statuses.length === 0 && (
            <p className="rounded-xl bg-slate-50 px-3 py-3 text-[10px] text-slate-400">暂无已同步角色。刷新页面并等待几秒后再试。</p>
          )}

          {statuses.map(status => (
            <div key={status.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-700">{status.name}</p>
                  <p className="mt-0.5 truncate text-[9px] text-slate-400">{status.id}</p>
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-500">
                  <span>{status.heartbeatEnabled ? '运行中' : '已关闭'}</span>
                  <input type="checkbox" checked={status.heartbeatEnabled}
                    disabled={updatingCharId === status.id}
                    onChange={() => void toggleCharacter(status)}
                    className="h-4 w-4 accent-teal-500 disabled:opacity-50" />
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded-lg bg-white px-2 py-1.5 text-slate-500">
                  <span className="block text-[9px] text-slate-400">下次心跳</span>
                  {formatTime(status.nextHeartbeatAt)}
                </div>
                <div className="rounded-lg bg-white px-2 py-1.5 text-slate-500">
                  <span className="block text-[9px] text-slate-400">连续未回复</span>
                  {status.unansweredSends} / 3
                </div>
              </div>
              <div className="mt-2 rounded-lg bg-white px-2 py-1.5">
                <span className="block text-[9px] text-slate-400">最近经历</span>
                <p className="mt-0.5 line-clamp-3 text-[10px] leading-relaxed text-slate-600">{experienceText(status)}</p>
              </div>
              {charactersById.get(status.id) ? (() => {
                const char = charactersById.get(status.id)!;
                const saved = getCharacterDeliveryAutonomy(char);
                const editing = editingDeliveryCharId === char.id;
                const eligibleAddresses = addresses.filter((address) => address.ownerId === 'user' || address.ownerId === char.id);
                const cards = cardsByChar[char.id] ?? [];
                return (
                  <div className="mt-2 rounded-lg border border-orange-100 bg-orange-50/60 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="block text-[9px] text-orange-500">心跳生活能力</span>
                        <span className="text-[10px] font-bold text-slate-600">自主点外卖 · {saved?.enabled ? '已开启' : '已关闭'}</span>
                      </div>
                      <button type="button" onClick={() => editing ? setEditingDeliveryCharId('') : beginDeliveryEdit(char)} className="rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-orange-600">
                        {editing ? '收起' : '设置'}
                      </button>
                    </div>
                    {editing ? (
                      <div className="mt-2 space-y-2 border-t border-orange-100 pt-2">
                        <label className="flex items-center justify-between text-[10px] text-slate-600">
                          <span>允许该角色在心跳中自主决定</span>
                          <input type="checkbox" checked={deliveryDraft.enabled} onChange={(event) => setDeliveryDraft((draft) => ({ ...draft, enabled: event.target.checked }))} className="h-4 w-4 accent-orange-500" />
                        </label>
                        {deliveryDraft.enabled ? <>
                          <select value={deliveryDraft.cardId} onChange={(event) => setDeliveryDraft((draft) => ({ ...draft, cardId: event.target.value }))} className="w-full rounded-lg border border-orange-100 bg-white px-2 py-2 text-[10px] text-slate-600">
                            <option value="">选择 {char.name} 的付款卡</option>
                            {cards.map((card) => <option key={card.id} value={card.id}>{card.nickname} · {card.last4} · ¥{card.balance.toFixed(2)}</option>)}
                          </select>
                          {cards.length === 0 ? <p className="text-[9px] text-orange-600">请先在存钱罐里给这个角色开卡。</p> : null}
                          <div className="space-y-1">
                            {eligibleAddresses.map((address) => {
                              const checked = deliveryDraft.allowedAddressIds.includes(address.id);
                              return <label key={address.id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-[10px] text-slate-600">
                                <input type="checkbox" checked={checked} onChange={() => setDeliveryDraft((draft) => ({
                                  ...draft,
                                  allowedAddressIds: checked ? draft.allowedAddressIds.filter((id) => id !== address.id) : [...draft.allowedAddressIds, address.id],
                                }))} className="accent-orange-500" />
                                <span>{address.label} · {address.ownerId === 'user' ? '给我' : `给${char.name}`}</span>
                              </label>;
                            })}
                            {eligibleAddresses.length === 0 ? <p className="text-[9px] text-orange-600">请先在外卖 App 添加地址。</p> : null}
                          </div>
                          <select value={deliveryDraft.frequency} onChange={(event) => setDeliveryDraft((draft) => ({ ...draft, frequency: event.target.value as CharacterDeliveryFrequency }))} className="w-full rounded-lg border border-orange-100 bg-white px-2 py-2 text-[10px] text-slate-600">
                            <option value="rare">很少发生</option><option value="normal">自然偶发</option><option value="often">相对主动</option>
                          </select>
                        </> : null}
                        <p className="text-[9px] leading-relaxed text-slate-400">云端只提出意图；当前设备会再次检查权限、角色卡、余额、地址、菜单和冷却。每个角色滚动 24 小时最多 2 单、间隔至少 6 小时，这只是上限，不是每日任务。</p>
                        <button type="button" onClick={() => saveDelivery(char)} className="w-full rounded-lg bg-orange-500 py-2 text-[10px] font-bold text-white">保存外卖授权</button>
                      </div>
                    ) : null}
                  </div>
                );
              })() : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CompanionBackendPanel;
