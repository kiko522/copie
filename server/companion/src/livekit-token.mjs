import { createHmac, randomBytes } from 'node:crypto';

const ROOM_PART = /^[A-Za-z0-9_.:@-]{1,80}$/;

const base64url = (value) => Buffer.from(value).toString('base64url');

const safePart = (value, fallback) => {
  const candidate = String(value ?? '').trim();
  return ROOM_PART.test(candidate) ? candidate : fallback;
};

export const createLiveKitJoinToken = ({ apiKey, apiSecret, room, identity, ttlSeconds = 600 }) => {
  if (!apiKey || !apiSecret) throw Object.assign(new Error('LiveKit 尚未配置'), { status: 503 });
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: apiKey,
    sub: identity,
    nbf: now - 5,
    exp: now + Math.min(3600, Math.max(60, ttlSeconds)),
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', apiSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
};

export const createRealtimeRoomCredentials = (config, input = {}) => {
  const nonce = randomBytes(9).toString('base64url');
  const characterId = safePart(input.characterId, 'character');
  const identity = safePart(input.identity, `user-${nonce}`);
  const room = `sully-${characterId}-${nonce}`.slice(0, 120);
  return {
    token: createLiveKitJoinToken({
      apiKey: config.livekitApiKey,
      apiSecret: config.livekitApiSecret,
      room,
      identity,
    }),
    livekitUrl: config.livekitUrl,
    room,
    identity,
    expiresIn: 600,
  };
};
