import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  clearStoredCode, clearStoredKey, readDeviceKey, readStoredCode, readStoredKey,
  writeStoredCode, writeStoredKey,
} from './credentials.js';

/**
 * The credentials file holds three unrelated things for the same origin, and
 * every writer has to leave the other two alone.
 *
 * This is not hypothetical: adding the API key was enough to break it. The
 * device key is minted lazily by the first request of any command, and its
 * writer rebuilt the file from the two fields it knew about — so saving a key
 * and then running anything at all silently deleted the key, which looks
 * exactly like a save that never happened.
 */
const withFreshHome = (body: (env: NodeJS.ProcessEnv) => void): void => {
  const home = mkdtempSync(join(tmpdir(), 'locker-credentials-'));
  try {
    body({ LOCKER_CONFIG: home });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

const origin = 'https://locker.example.test';

test('minting a device key leaves the saved code and API key alone', () => {
  withFreshHome((env) => {
    writeStoredCode(origin, 'K7F29QB3', env);
    writeStoredKey(origin, 'cdc_a_secret_key_value', env);

    readDeviceKey(origin, env);

    assert.equal(readStoredCode(origin, env), 'K7F29QB3');
    assert.equal(readStoredKey(origin, env), 'cdc_a_secret_key_value');
  });
});

test('saving a code leaves the API key alone, and the other way round', () => {
  withFreshHome((env) => {
    writeStoredKey(origin, 'cdc_a_secret_key_value', env);
    writeStoredCode(origin, 'K7F29QB3', env);
    assert.equal(readStoredKey(origin, env), 'cdc_a_secret_key_value');

    writeStoredKey(origin, 'cdc_a_second_key_value', env);
    assert.equal(readStoredCode(origin, env), 'K7F29QB3');
    assert.equal(readStoredKey(origin, env), 'cdc_a_second_key_value');
  });
});

test('each origin keeps its own key', () => {
  withFreshHome((env) => {
    writeStoredKey(origin, 'cdc_the_public_one', env);
    writeStoredKey('http://localhost:8080', 'cdc_the_local_one', env);

    assert.equal(readStoredKey(origin, env), 'cdc_the_public_one');
    assert.equal(readStoredKey('http://localhost:8080', env), 'cdc_the_local_one');
  });
});

/**
 * Signing out is about whoever is sitting here, and the key belongs to a
 * mentor's tooling — on a shared laptop those are different people.
 */
test('logging out forgets the code but keeps the API key', () => {
  withFreshHome((env) => {
    writeStoredCode(origin, 'K7F29QB3', env);
    writeStoredKey(origin, 'cdc_a_secret_key_value', env);

    assert.equal(clearStoredCode(origin, env), true);

    assert.equal(readStoredCode(origin, env), null);
    assert.equal(readStoredKey(origin, env), 'cdc_a_secret_key_value');

    assert.equal(clearStoredKey(origin, env), true);
    assert.equal(readStoredKey(origin, env), null);
  });
});

test('forgetting something that was never saved says so', () => {
  withFreshHome((env) => {
    assert.equal(clearStoredCode(origin, env), false);
    assert.equal(clearStoredKey(origin, env), false);
  });
});
