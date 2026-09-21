import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenMatches } from '../src/http.mjs';

test('Bearer token comparison is exact', () => {
  assert.equal(tokenMatches('Bearer abc', 'abc'), true);
  assert.equal(tokenMatches('Bearer abcd', 'abc'), false);
  assert.equal(tokenMatches('', 'abc'), false);
});
