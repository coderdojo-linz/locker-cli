import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUploadPath, safeRelativeTarget } from './uploadPath.js';

test('splits a folder path into a folder and a name', () => {
  const parsed = parseUploadPath('site/img/logo.png');
  assert.equal(parsed.error, null);
  assert.equal(parsed.name, 'logo.png');
  assert.equal(parsed.relativePath, 'site/img');
});

test('treats a Windows path as the same path', () => {
  const parsed = parseUploadPath('site\\img\\logo.png');
  assert.equal(parsed.error, null);
  assert.equal(parsed.relativePath, 'site/img');
});

test('refuses paths that climb out of the chosen folder', () => {
  for (const bad of ['../secrets.txt', 'a/../../b.txt', '/etc/passwd', 'C:/Windows/system.ini']) {
    assert.notEqual(parseUploadPath(bad).error, null, `${bad} should be refused`);
  }
});

test('refuses names that break on some systems', () => {
  assert.notEqual(parseUploadPath('CON.txt').error, null);
  assert.notEqual(parseUploadPath('trailing.').error, null);
  assert.notEqual(parseUploadPath('a<b>.txt').error, null);
});

// The check that actually keeps a hostile file name from being written outside
// the folder somebody chose, which is why it is asserted separately.
test('safeRelativeTarget refuses anything that would escape the download folder', () => {
  assert.equal(safeRelativeTarget('..', 'evil.txt'), null);
  assert.equal(safeRelativeTarget('../..', 'id_rsa'), null);
  assert.equal(safeRelativeTarget(null, '../../evil.txt'), null);

  const safe = safeRelativeTarget('img', 'logo.png');
  assert.deepEqual(safe?.segments, ['img', 'logo.png']);
});
