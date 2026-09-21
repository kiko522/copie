import React, { useState } from 'react';
import {
  loadCompanionBackendConfig,
  saveCompanionBackendConfig,
  testCompanionBackend,
  testCompanionBackendAuth,
  type CompanionBackendConfig,
} from '../../utils/companionBackendClient';

interface Props {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const CompanionBackendPanel: React.FC<Props> = ({ addToast }) => {
  const [config, setConfig] = useState<CompanionBackendConfig>(() => loadCompanionBackendConfig());
  const [testing, setTesting] = useState(false);

  const update = <K extends keyof CompanionBackendConfig>(key: K, value: CompanionBackendConfig[K]) =>
    setConfig(current => ({ ...current, [key]: value }));

  const save = () => {
    saveCompanionBackendConfig(config);
    addToast(config.enabled ? '个人陪伴后端已保存并开始同步' : '个人陪伴后端已关闭', 'success');
  };

  const test = async () => {
    setTesting(true);
    try {
      saveCompanionBackendConfig(config);
      await testCompanionBackend();
      if (config.enabled) await testCompanionBackendAuth();
      addToast(config.enabled ? '后端连接与令牌验证成功' : '后端健康检查成功；启用后可继续验证令牌', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '后端连接失败', 'error');
    } finally { setTesting(false); }
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
    </div>
  );
};

export default CompanionBackendPanel;
