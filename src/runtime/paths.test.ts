import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { configDirectory } from './paths.js';
import { safeDirectoryName } from '../domain/download.js';

/**
 * Both platforms, from whichever platform is running the tests.
 *
 * The whole point of the platform branch is that it is wrong on the machine
 * that cannot run it, so neither branch is left to be discovered by a user.
 */

test('Windows keeps its settings under APPDATA', () => {
  const directory = configDirectory(
    { APPDATA: 'C:\\Users\\Kim\\AppData\\Roaming' },
    'win32',
    'C:\\Users\\Kim',
  );
  assert.ok(directory.includes('locker'));
  assert.ok(directory.includes('AppData'));
});

test('Windows without APPDATA still lands in the profile, not in the root', () => {
  const directory = configDirectory({}, 'win32', 'C:\\Users\\Kim');
  assert.ok(directory.includes('Kim'));
  assert.ok(directory.includes('locker'));
});

test('Linux honours XDG_CONFIG_HOME when it is absolute', () => {
  const directory = configDirectory({ XDG_CONFIG_HOME: '/home/kim/.xdg' }, 'linux', '/home/kim');
  assert.equal(directory, path.join('/home/kim/.xdg', 'locker'));
});

test('Linux falls back to ~/.config, and ignores a relative XDG value', () => {
  const fallback = configDirectory({}, 'linux', '/home/kim');
  assert.ok(fallback.includes('.config'));
  assert.ok(fallback.includes('locker'));

  // A relative XDG_CONFIG_HOME is against the spec; resolving it against the
  // working directory would scatter config wherever the CLI happened to run.
  const relative = configDirectory({ XDG_CONFIG_HOME: 'relative/path' }, 'linux', '/home/kim');
  assert.equal(relative, fallback);
});

test('LOCKER_CONFIG wins on every platform', () => {
  for (const platform of ['win32', 'linux', 'darwin'] as NodeJS.Platform[]) {
    const directory = configDirectory({ LOCKER_CONFIG: '/tmp/here' }, platform, '/home/kim');
    assert.ok(directory.endsWith(`here`), `${platform} should honour LOCKER_CONFIG`);
  }
});

// Project names are up to 120 characters of whatever a child typed, and they
// become a folder name on both platforms.
test('a project name becomes a folder name every file system accepts', () => {
  assert.equal(safeDirectoryName('Snake: the game?'), 'Snake- the game-');
  assert.equal(safeDirectoryName('a/b\\c'), 'a-b-c');
  assert.equal(safeDirectoryName('trailing dot.'), 'trailing dot');
  assert.equal(safeDirectoryName('   '), 'project');
  assert.equal(safeDirectoryName('CON'), 'CON-project');
  assert.ok(safeDirectoryName('x'.repeat(300)).length <= 80);
});
