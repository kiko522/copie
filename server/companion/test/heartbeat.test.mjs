import test from 'node:test';
import assert from 'node:assert/strict';
import { mayContact } from '../src/heartbeat.mjs';

test('three unanswered messages pause further proactive contact', () => {
  assert.equal(mayContact(0, 3), true);
  assert.equal(mayContact(2, 3), true);
  assert.equal(mayContact(3, 3), false);
  assert.equal(mayContact(4, 3), false);
});
