import React, { useCallback, useEffect, useState } from 'react';
import {
  listCompanionCharacterStatuses,
  loadCompanionBackendConfig,
  saveCompanionBackendConfig,
  setCompanionCharacterHeartbeatEnabled,
  testCompanionBackend,
  testCompanionBackendAuth,
  type CompanionBackendConfig,
  type CompanionCharacterStatus,
} from '../../utils/companionBackendClient';

interface Props {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const CompanionBackendPanel: React.FC<Props> = ({ addToast }) => {
  const [config, setConfig] = useState<CompanionBackendConfig>(() => loadCompanionBackendConfig());
  const [testing, setTesting] = useState(false);
  const [statuses, setStatuses] = useState<CompanionCharacterStatus[]>([]);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [updatingCharId, setUpdatingCharId] = useState('');

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
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CompanionBackendPanel;
