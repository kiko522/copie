import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createLiveKitJoinToken, createRealtimeRoomCredentials } from '../src/livekit-token.mjs';

test('signs a short-lived room-scoped LiveKit token', () => {
  const secret = 'secret-for-test';
  const token = createLiveKitJoinToken({ apiKey: 'APItest', apiSecret: secret, room: 'room-1', identity: 'user-1' });
  const [head, body, signature] = token.split('.');
  assert.equal(createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url'), signature);
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  assert.equal(payload.iss, 'APItest');
  assert.equal(payload.sub, 'user-1');
  assert.deepEqual(payload.video, {
    room: 'room-1', roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true,
  });
  assert.ok(payload.exp - payload.nbf <= 605);
});

test('room credentials do not expose the API secret and sanitize identifiers', () => {
  const result = createRealtimeRoomCredentials({
    livekitUrl: 'wss://example.livekit.cloud', livekitApiKey: 'APItest', livekitApiSecret: 'secret',
  }, { characterId: '../../bad id', identity: 'me' });
  assert.equal(result.livekitUrl, 'wss://example.livekit.cloud');
  assert.equal(result.identity, 'me');
  assert.match(result.room, /^sully-character-/);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
