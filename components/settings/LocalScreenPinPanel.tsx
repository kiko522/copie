import React, { useState } from 'react';
import {
  changeLocalScreenPin,
  isLocalScreenPinEnabled,
  removeLocalScreenPin,
  setLocalScreenPin,
} from '../../utils/localScreenPin';

interface Props {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const PinInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}> = ({ label, value, onChange, autoComplete = 'off' }) => (
  <label className="block">
    <span className="text-[10px] text-slate-500">{label}</span>
    <input
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={6}
      autoComplete={autoComplete}
      value={value}
      onChange={event => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-base tracking-[0.45em] text-slate-700 outline-none focus:border-violet-300"
    />
  </label>
);

const LocalScreenPinPanel: React.FC<Props> = ({ addToast }) => {
  const [enabled, setEnabled] = useState(() => isLocalScreenPinEnabled());
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);

  const clear = () => { setCurrentPin(''); setNewPin(''); setConfirmPin(''); };
  const validateNewPin = () => {
    if (!/^\d{4,6}$/.test(newPin)) throw new Error('PIN 必须是 4–6 位数字');
    if (newPin !== confirmPin) throw new Error('两次输入的 PIN 不一致');
  };

  const save = async () => {
    setBusy(true);
    try {
      validateNewPin();
      if (enabled) {
        if (!await changeLocalScreenPin(currentPin, newPin)) throw new Error('当前 PIN 不正确');
        addToast('本地锁屏 PIN 已修改', 'success');
      } else {
        await setLocalScreenPin(newPin);
        setEnabled(true);
        addToast('本地锁屏 PIN 已启用，下次打开网页时生效', 'success');
      }
      clear();
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'PIN 保存失败', 'error');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      if (!await removeLocalScreenPin(currentPin)) throw new Error('当前 PIN 不正确');
      setEnabled(false);
      clear();
      addToast('本地锁屏 PIN 已关闭', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'PIN 关闭失败', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-slate-50 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-600">本地浏览器 PIN</span>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
            {enabled ? '已启用' : '未启用'}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">每次重新打开或刷新网页后，在模拟锁屏上输入 PIN。PIN 只保存在当前浏览器，且不会保存明文。</p>
      </div>

      {enabled && <PinInput label="当前 PIN" value={currentPin} onChange={setCurrentPin} autoComplete="current-password" />}
      <PinInput label={enabled ? '新 PIN（4–6 位）' : '设置 PIN（4–6 位）'} value={newPin} onChange={setNewPin} autoComplete="new-password" />
      <PinInput label="再次输入新 PIN" value={confirmPin} onChange={setConfirmPin} autoComplete="new-password" />

      <div className={`grid gap-2 ${enabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button type="button" onClick={() => void save()} disabled={busy}
          className="rounded-xl bg-violet-500 py-2.5 text-xs font-bold text-white disabled:opacity-50">
          {busy ? '处理中…' : enabled ? '修改 PIN' : '启用 PIN'}
        </button>
        {enabled && (
          <button type="button" onClick={() => void disable()} disabled={busy || !currentPin}
            className="rounded-xl border border-rose-200 bg-white py-2.5 text-xs font-bold text-rose-500 disabled:opacity-50">
            关闭 PIN
          </button>
        )}
      </div>
      <p className="text-[10px] leading-relaxed text-amber-600">忘记 PIN 时，只能清除此网站的本地存储来重置；这样也会清除当前浏览器中的小手机数据，请务必保留备份。</p>
    </div>
  );
};

export default LocalScreenPinPanel;
