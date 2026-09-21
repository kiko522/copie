import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompanionApp } from '../src/server.mjs';
import { CompanionStore } from '../src/store.mjs';

test('authenticated character snapshot and outbox API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sully-api-'));
  const store = new CompanionStore(dir);
  const token = 't'.repeat(32);
  const config = {
    port: 0, backendToken: token, allowedOrigins: new Set(['https://app.example.com']),
    tavilyApiKey: '', itboyCityCodes: {}, upstreamTimeoutMs: 1000,
    llmBaseUrl: '', llmApiKey: '', heartbeatModel: '', trendRadarMcpUrl: '',
    userTimeZone: 'Asia/Shanghai', quietStart: '02:00', quietEnd: '08:30',
    maxUnansweredSends: 3, heartbeatTickMs: 60_000, dataDir: dir,
    livekitUrl: 'wss://example.livekit.cloud', livekitApiKey: 'APItest', livekitApiSecret: 'secret',
  };
  const app = createCompanionApp(config, store);
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const preflight = await fetch(`${base}/v1/characters/c1`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-methods') || '', /\bPUT\b/);
    assert.match(preflight.headers.get('access-control-allow-methods') || '', /\bPATCH\b/);
    assert.match(preflight.headers.get('access-control-allow-methods') || '', /\bDELETE\b/);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example.com');

    assert.equal((await fetch(`${base}/v1/capabilities`)).status, 401);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const realtime = await (await fetch(`${base}/v1/realtime/token`, {
      method: 'POST', headers, body: JSON.stringify({ characterId: 'c1', identity: 'phone' }),
    })).json();
    assert.equal(realtime.livekitUrl, 'wss://example.livekit.cloud');
    assert.match(realtime.room, /^sully-c1-/);
    assert.equal(realtime.token.split('.').length, 3);
    const saved = await fetch(`${base}/v1/characters/c1`, {
      method: 'PUT', headers, body: JSON.stringify({ name: '小满', persona: '安静', recentMessages: [] }),
    });
    assert.equal(saved.status, 200);
    const statusList = await (await fetch(`${base}/v1/characters`, { headers })).json();
    assert.equal(statusList.items[0].name, '小满');
    assert.equal(statusList.items[0].heartbeatEnabled, true);
    const disabled = await (await fetch(`${base}/v1/characters/c1/heartbeat`, {
      method: 'PATCH', headers, body: JSON.stringify({ enabled: false }),
    })).json();
    assert.equal(disabled.heartbeatEnabled, false);
    assert.deepEqual(app.store.dueCharacters(Number.MAX_SAFE_INTEGER), []);
    store.enqueue('c1', '测试主动消息');
    const outbox = await (await fetch(`${base}/v1/outbox?charId=c1`, { headers })).json();
    assert.equal(outbox.items[0].content, '测试主动消息');
    const acked = await fetch(`${base}/v1/outbox/${outbox.items[0].id}/ack`, { method: 'POST', headers });
    assert.equal(acked.status, 200);
    store.appendExperience('c1', 'read_trend', { experience: '测试经历' });
    store.enqueue('c1', '另一条测试消息');
    const cleared = await (await fetch(`${base}/v1/characters/c1/history`, { method: 'DELETE', headers })).json();
    assert.equal(cleared.ok, true);
    assert.equal(cleared.deletedExperiences, 1);
    assert.equal(cleared.deletedOutbox, 2);
    assert.deepEqual(store.getCharacter('c1').snapshot.recentMessages, []);
    assert.equal(store.getCharacter('c1').heartbeatEnabled, false);
    assert.equal(store.getCharacter('c1').unansweredSends, 0);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
