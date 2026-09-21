import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, validateConfig } from '../src/config.mjs';

test('loads allow-list and valid itboy city codes', () => {
  const config = loadConfig({
    BACKEND_TOKEN: 'x'.repeat(32),
    ALLOWED_ORIGINS: 'https://app.example.com, http://127.0.0.1:5173 ',
    ITBOY_CITY_CODES: '{"北京":"101010100","坏":"abc"}',
  });
  assert.equal(config.allowedOrigins.has('https://app.example.com'), true);
  assert.deepEqual(config.itboyCityCodes, { 北京: '101010100' });
  assert.deepEqual(validateConfig(config), []);
});

test('rejects weak production secrets', () => {
  const config = loadConfig({ BACKEND_TOKEN: 'short', ALLOWED_ORIGINS: '' });
  assert.equal(validateConfig(config).length, 2);
});
