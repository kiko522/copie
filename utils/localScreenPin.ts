const STORAGE_KEY = 'sully_local_screen_pin_v1';
const ITERATIONS = 150_000;

interface StoredPin {
  version: 1;
  salt: string;
  hash: string;
  length: number;
  iterations: number;
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

const readStoredPin = (): StoredPin | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<StoredPin> | null;
    if (parsed?.version !== 1 || !parsed.salt || !parsed.hash || !parsed.length || !parsed.iterations) return null;
    return parsed as StoredPin;
  } catch {
    return null;
  }
};

const deriveHash = async (pin: string, salt: Uint8Array, iterations: number): Promise<string> => {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256);
  return bytesToBase64(new Uint8Array(bits));
};

const validPin = (pin: string): boolean => /^\d{4,6}$/.test(pin);

export const isLocalScreenPinEnabled = (): boolean => readStoredPin() !== null;

export const getLocalScreenPinLength = (): number => readStoredPin()?.length || 4;

export const verifyLocalScreenPin = async (pin: string): Promise<boolean> => {
  const stored = readStoredPin();
  if (!stored || pin.length !== stored.length) return false;
  const actual = await deriveHash(pin, base64ToBytes(stored.salt), stored.iterations);
  if (actual.length !== stored.hash.length) return false;
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) mismatch |= actual.charCodeAt(index) ^ stored.hash.charCodeAt(index);
  return mismatch === 0;
};

export const setLocalScreenPin = async (pin: string): Promise<void> => {
  if (!validPin(pin)) throw new Error('PIN 必须是 4–6 位数字');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const record: StoredPin = {
    version: 1,
    salt: bytesToBase64(salt),
    hash: await deriveHash(pin, salt, ITERATIONS),
    length: pin.length,
    iterations: ITERATIONS,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
};

export const changeLocalScreenPin = async (currentPin: string, newPin: string): Promise<boolean> => {
  if (!await verifyLocalScreenPin(currentPin)) return false;
  await setLocalScreenPin(newPin);
  return true;
};

export const removeLocalScreenPin = async (currentPin: string): Promise<boolean> => {
  if (!await verifyLocalScreenPin(currentPin)) return false;
  localStorage.removeItem(STORAGE_KEY);
  return true;
};
