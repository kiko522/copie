import React, { useEffect, useState } from 'react';
import { getLocalScreenPinLength, verifyLocalScreenPin } from '../../utils/localScreenPin';

interface Props { onUnlock: () => void; }

const LocalPinUnlock: React.FC<Props> = ({ onUnlock }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const targetLength = getLocalScreenPinLength();

  const submit = async (candidate: string) => {
    if (checking || candidate.length !== targetLength) return;
    setChecking(true);
    if (await verifyLocalScreenPin(candidate)) {
      onUnlock();
      return;
    }
    setError('PIN 不正确');
    setPin('');
    setChecking(false);
  };

  const addDigit = (digit: string) => {
    if (checking || pin.length >= targetLength) return;
    setError('');
    const next = `${pin}${digit}`;
    setPin(next);
    if (next.length === targetLength) void submit(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) addDigit(event.key);
      else if (event.key === 'Backspace') { setPin(value => value.slice(0, -1)); setError(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-end bg-black/35 pb-[calc(2.5rem+var(--safe-bottom,0px))] backdrop-blur-xl"
      onClick={event => event.stopPropagation()}>
      <div className="mb-5 text-center text-white drop-shadow">
        <p className="text-sm font-semibold tracking-widest">输入 PIN 解锁</p>
        <div className="mt-3 flex justify-center gap-3">
          {Array.from({ length: targetLength }, (_, index) => (
            <span key={index} className={`h-3 w-3 rounded-full border border-white/80 ${index < pin.length ? 'bg-white' : 'bg-transparent'}`} />
          ))}
        </div>
        <p className={`mt-2 h-4 text-[11px] ${error ? 'text-rose-200' : 'text-white/60'}`}>{error || (checking ? '正在验证…' : '')}</p>
      </div>
      <div className="grid w-64 grid-cols-3 gap-x-5 gap-y-3">
        {['1','2','3','4','5','6','7','8','9'].map(digit => (
          <button key={digit} type="button" onClick={() => addDigit(digit)} disabled={checking}
            className="h-14 rounded-full bg-white/20 text-xl font-medium text-white shadow-sm ring-1 ring-white/25 backdrop-blur active:scale-95 disabled:opacity-60">
            {digit}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => addDigit('0')} disabled={checking}
          className="h-14 rounded-full bg-white/20 text-xl font-medium text-white shadow-sm ring-1 ring-white/25 backdrop-blur active:scale-95 disabled:opacity-60">0</button>
        <button type="button" onClick={() => { setPin(value => value.slice(0, -1)); setError(''); }} disabled={!pin || checking}
          className="h-14 text-xs font-medium text-white/90 disabled:opacity-30">删除</button>
      </div>
    </div>
  );
};

export default LocalPinUnlock;
