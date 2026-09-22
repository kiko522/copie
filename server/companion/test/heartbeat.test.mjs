import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeartbeatEngine, mayContact } from '../src/heartbeat.mjs';
import { CompanionStore } from '../src/store.mjs';

test('three unanswered messages pause further proactive contact', () => {
  assert.equal(mayContact(0, 3), true);
  assert.equal(mayContact(2, 3), true);
  assert.equal(mayContact(3, 3), false);
  assert.equal(mayContact(4, 3), false);
});

test('heartbeat creates one structured delivery outbox item and pending blocks another', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sully-heartbeat-delivery-'));
  const store = new CompanionStore(dir);
  const now = new Date('2026-09-22T12:00:00+08:00');
  let calls = 0;
  const callModel = async ({ deliveryEligibility }) => {
    calls += 1;
    return deliveryEligibility.allowed ? {
      action: 'life', experience: '路过茶店', thought: '她刚刚说想喝奶茶', shouldContact: false,
      deliveryOrder: { addressId: 'home', storeId: 'tea', items: [{ productId: 'milk-tea', quantity: 1 }] },
      nextIntervalMinutes: 60,
    } : { action: 'idle', experience: '', thought: '', shouldContact: false, deliveryOrder: null, nextIntervalMinutes: 60 };
  };
  const config = {
    userTimeZone: 'Asia/Shanghai', quietStart: '02:00', quietEnd: '08:30', maxUnansweredSends: 3,
    heartbeatTickMs: 60_000, trendRadarMcpUrl: '', upstreamTimeoutMs: 100,
  };
  try {
    store.upsertCharacter('c1', {
      name: '小满',
      deliveryAutonomy: {
        enabled: true, paymentReady: true, allowedAddresses: [{ id: 'home', recipient: 'user', label: '家' }],
        recentPlacedAt: [], catalog: [{ id: 'tea', name: '茶店', minimumOrder: 15, products: [{ id: 'milk-tea', name: '奶茶', price: 16 }] }],
      },
    }, now.getTime());
    const engine = new HeartbeatEngine({ config, store, callModel });
    const first = await engine.runCharacter('c1', now);
    assert.equal(first.status, 'contact_enqueued');
    const outbox = store.listOutbox('c1');
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].metadata.deliveryOrderIntent.addressId, 'home');
    await engine.runCharacter('c1', new Date(now.getTime() + 60_000));
    assert.equal(store.listOutbox('c1').length, 1);
    assert.equal(calls, 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
