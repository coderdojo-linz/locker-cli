import assert from 'node:assert/strict';
import test from 'node:test';
import { codeProblem, formatCode, maskCode, normalizeCode } from './code.js';
import { normalizeOrigin } from './context.js';

test('a code is read the way it is printed on the card', () => {
  for (const typed of ['K7F2 9QB3', 'k7f2-9qb3', 'K7F29QB3', ' k7f2 9qb3 ']) {
    assert.equal(normalizeCode(typed), 'K7F29QB3', `${typed} should normalize`);
  }
});

test('a code is shown back in two groups of four', () => {
  assert.equal(formatCode('K7F29QB3'), 'K7F2 9QB3');
});

test('a masked code keeps only enough to recognise it', () => {
  const masked = maskCode('K7F29QB3');
  assert.ok(masked.endsWith('9QB3'));
  assert.ok(!masked.includes('K7F2'));
});

test('a wrong-length code is caught before it is spent on a request', () => {
  assert.equal(codeProblem('K7F29QB3'), null);
  assert.notEqual(codeProblem('K7F2'), null);
  assert.notEqual(codeProblem(''), null);
});

// Credentials are filed under the origin, so these all have to land on one key
// or a kid who types the host differently is told they are not signed in.
test('hosts that mean the same place produce one origin', () => {
  const expected = 'https://locker.coderdojo.net';
  for (const written of [
    'locker.coderdojo.net',
    'https://locker.coderdojo.net',
    'https://locker.coderdojo.net/',
    'https://LOCKER.CoderDojo.NET/desk?view=codes',
  ]) {
    assert.equal(normalizeOrigin(written), expected, `${written} should normalize`);
  }
});

test('a different port is a different place', () => {
  assert.equal(normalizeOrigin('http://localhost:5034'), 'http://localhost:5034');
  assert.notEqual(normalizeOrigin('http://localhost:5034'), normalizeOrigin('http://localhost:8080'));
});
