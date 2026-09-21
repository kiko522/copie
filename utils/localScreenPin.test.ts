import { beforeEach, describe, expect, it } from 'vitest';
import {
  changeLocalScreenPin,
  getLocalScreenPinLength,
  isLocalScreenPinEnabled,
  removeLocalScreenPin,
  setLocalScreenPin,
  verifyLocalScreenPin,
} from './localScreenPin';

describe('local screen PIN', () => {
  beforeEach(() => localStorage.clear());

  it('stores only a salted verifier and supports change and removal', async () => {
    await setLocalScreenPin('1234');
    expect(isLocalScreenPinEnabled()).toBe(true);
    expect(getLocalScreenPinLength()).toBe(4);
    expect(JSON.stringify(localStorage)).not.toContain('1234');
    expect(await verifyLocalScreenPin('1234')).toBe(true);
    expect(await verifyLocalScreenPin('9999')).toBe(false);

    expect(await changeLocalScreenPin('9999', '567890')).toBe(false);
    expect(await changeLocalScreenPin('1234', '567890')).toBe(true);
    expect(getLocalScreenPinLength()).toBe(6);
    expect(await verifyLocalScreenPin('567890')).toBe(true);

    expect(await removeLocalScreenPin('1234')).toBe(false);
    expect(await removeLocalScreenPin('567890')).toBe(true);
    expect(isLocalScreenPinEnabled()).toBe(false);
  });

  it('rejects PINs outside 4–6 numeric digits', async () => {
    await expect(setLocalScreenPin('123')).rejects.toThrow('4–6 位数字');
    await expect(setLocalScreenPin('12ab')).rejects.toThrow('4–6 位数字');
    await expect(setLocalScreenPin('1234567')).rejects.toThrow('4–6 位数字');
  });
});
