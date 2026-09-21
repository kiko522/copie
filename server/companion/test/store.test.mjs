import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionStore } from '../src/store.mjs';

test('character, append-only experience, outbox and reply reset round-trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sully-companion-'));
  const store = new CompanionStore(dir);
  try {
    store.upsertCharacter('c1', { name: '小满' }, 1000);
    store.appendExperience('c1', 'life', { text: '散步' }, 2000);
    const first = store.enqueue('c1', '看到一件事', { source: 'heartbeat' }, 3000);
    store.enqueue('c1', '又想到一点', {}, 4000);
    assert.equal(store.getCharacter('c1').unansweredSends, 2);
    assert.equal(store.recentExperiences('c1')[0].content.text, '散步');
    assert.equal(store.listOutbox('c1').length, 2);
    assert.equal(store.ackOutbox(first.id, 5000), true);
    assert.equal(store.listOutbox('c1').length, 1);
    store.userReplied('c1', 6000);
    assert.equal(store.getCharacter('c1').unansweredSends, 0);
    assert.equal(store.getCharacter('c1').heartbeatEnabled, true);
    assert.equal(store.setHeartbeatEnabled('c1', false, 7000).heartbeatEnabled, false);
    assert.equal(store.dueCharacters(1_000_000).length, 0);
    assert.equal(store.setHeartbeatEnabled('c1', true, 8000).heartbeatEnabled, true);
    assert.equal(store.dueCharacters(68_000)[0].id, 'c1');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
