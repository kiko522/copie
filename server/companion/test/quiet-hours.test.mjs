import test from 'node:test';
import assert from 'node:assert/strict';
import { quietDelayMs } from '../src/quiet-hours.mjs';

test('02:00-08:30 blocks a Shanghai 03:00 heartbeat until 08:30', () => {
  const delay = quietDelayMs(new Date('2026-09-20T19:00:00Z'), 'Asia/Shanghai', '02:00', '08:30');
  assert.equal(delay, 330 * 60_000);
});

test('daytime is not quiet', () => {
  assert.equal(quietDelayMs(new Date('2026-09-21T04:00:00Z'), 'Asia/Shanghai', '02:00', '08:30'), 0);
});
