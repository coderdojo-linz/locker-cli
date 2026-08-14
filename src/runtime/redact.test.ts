import assert from 'node:assert/strict';
import test from 'node:test';
import { redact, redactDeep } from './redact.js';

test('the locker code is removed wherever it appears', () => {
  const line = 'GET https://locker.coderdojo.net/api/lockers/K7F29QB3/projects';
  const cleaned = redact(line, { code: 'K7F29QB3' });
  assert.ok(!cleaned.includes('K7F29QB3'));
  assert.ok(cleaned.includes('/api/lockers/'));
});

test('a signature on a storage URL is removed', () => {
  const url = 'https://acct.blob.core.windows.net/c/abc.png?sv=2024-01-01&sig=ZmFrZXNpZw%3D%3D&se=2026';
  const cleaned = redact(url);
  assert.ok(!cleaned.includes('ZmFrZXNpZw'));
  assert.ok(!cleaned.includes('2024-01-01'));
});

test('a signed local upload token is removed', () => {
  const cleaned = redact('PUT /api/projects/uploads/eyJhbGciOi.someverylongtoken');
  assert.ok(!cleaned.includes('eyJhbGciOi'));
});

test('secret-named fields are removed whatever they hold', () => {
  const cleaned = redactDeep({
    ticket: 'abc123',
    headers: { Authorization: 'Bearer xyz' },
    name: 'sprite.png',
  }) as Record<string, unknown>;

  assert.equal(cleaned['ticket'], '[redacted]');
  assert.equal((cleaned['headers'] as Record<string, string>)['Authorization'], '[redacted]');
  assert.equal(cleaned['name'], 'sprite.png');
});

// A short string would match everywhere and turn a whole log into mask
// characters, which is worse than useless for a bug report.
test('a suspiciously short secret is not used as a pattern', () => {
  assert.equal(redact('a beautiful day', { code: 'a' }), 'a beautiful day');
});
