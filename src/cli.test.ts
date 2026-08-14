import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The contract, checked by running the real thing.
 *
 * Everything here is deliberately offline: these assert the promises the CLI
 * makes before it reaches a network — which output goes to which stream, what
 * `--json` looks like, and that nothing destructive or interactive happens when
 * there is nobody at a keyboard.
 */

const run = promisify(execFile);
const cli = fileURLToPath(new URL('./index.js', import.meta.url));

// Its own config directory, so a test run never reads or writes the settings of
// whoever is running it.
const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'locker-cli-test-'));
after(() => fs.rmSync(configDirectory, { recursive: true, force: true }));

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

async function locker(args: string[], env: NodeJS.ProcessEnv = {}): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args], {
      env: {
        ...process.env,
        LOCKER_CONFIG: configDirectory,
        // Unset so a developer's own shell cannot make these tests pass or fail.
        LOCKER_CODE: '',
        LOCKER_HOST: '',
        LOCKER_OUTPUT: '',
        NO_COLOR: '1',
        ...env,
      },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

const isJson = (value: string): boolean => {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};

test('--help explains itself on stdout and exits 0', async () => {
  const result = await locker(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /COMMON TASKS/);
  assert.match(result.stdout, /upload/);
  // Help is for a person. If this ever becomes JSON, the default output
  // contract has been broken.
  assert.equal(isJson(result.stdout), false);
});

test('a command names its own destructive nature in help', async () => {
  const result = await locker(['projects', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /cannot be undone/);
});

test('an unfinished command refuses instead of guessing', async () => {
  const branch = await locker(['projects']);
  assert.equal(branch.code, 2);
  // The page is help, so it belongs on stderr when the command did not run.
  assert.match(branch.stderr, /COMMANDS/);
  assert.equal(branch.stdout, '');

  const unknown = await locker(['frobnicate']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /no "frobnicate" command/);
});

test('a missing locker code is "not authenticated", not "not found"', async () => {
  const result = await locker(['projects', 'list']);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /locker auth login/);
});

// The output-contract regression check the skill asks for, both halves.
test('list output is a table by default and an envelope under --json', async () => {
  const human = await locker(['config', 'get']);
  assert.equal(human.code, 0);
  assert.equal(isJson(human.stdout), false, 'default output must not be JSON');
  assert.match(human.stdout, /KEY/);

  const machine = await locker(['config', 'get', '--json']);
  assert.equal(machine.code, 0);
  assert.ok(isJson(machine.stdout), '--json output must parse');

  const envelope = JSON.parse(machine.stdout) as {
    ok: boolean;
    data: unknown;
    error: unknown;
    meta: { schemaVersion: number };
  };
  assert.equal(envelope.ok, true);
  assert.equal(envelope.error, null);
  assert.equal(envelope.meta.schemaVersion, 1);
});

test('a failure in --json mode is still an envelope on stdout', async () => {
  const result = await locker(['projects', 'list', '--json']);
  assert.equal(result.code, 3);
  assert.ok(isJson(result.stdout), 'errors must stay parseable in machine mode');

  const envelope = JSON.parse(result.stdout) as {
    ok: boolean;
    error: { kind: string; recovery?: string };
    meta: { schemaVersion: number };
  };
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.kind, 'not-authenticated');
  assert.equal(envelope.error.recovery, 'locker auth login');
  assert.equal(envelope.meta.schemaVersion, 1);
});

test('asking for human and machine output at once is refused', async () => {
  const result = await locker(['config', 'get', '--json', '--no-json']);
  assert.equal(result.code, 2);
});

test('flags beat the environment, and the environment beats what is saved', async () => {
  await locker(['config', 'set', 'host', 'https://saved.example.org']);

  const fromFile = await locker(['config', 'get', '--json']);
  assert.match(fromFile.stdout, /saved\.example\.org/);

  const fromEnvironment = await locker(['config', 'get', '--json'], {
    LOCKER_HOST: 'https://from-env.example.org',
  });
  const viaEnvironment = JSON.parse(fromEnvironment.stdout) as {
    data: { effective: { host: string } };
  };
  assert.equal(viaEnvironment.data.effective.host, 'https://from-env.example.org');

  const fromFlag = await locker(
    ['config', 'get', '--json', '--host', 'https://from-flag.example.org'],
    { LOCKER_HOST: 'https://from-env.example.org' },
  );
  const viaFlag = JSON.parse(fromFlag.stdout) as { data: { effective: { host: string } } };
  assert.equal(viaFlag.data.effective.host, 'https://from-flag.example.org');

  await locker(['config', 'clear', 'host', '--yes']);
});

// `raw` takes a path from the user, so it is the one place a request could be
// aimed somewhere else — taking the locker code with it.
test('raw will not send the locker code to another host', async () => {
  const result = await locker(['raw', 'GET', 'https://example.com/steal'], {
    LOCKER_CODE: 'K7F29QB3',
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /rather than/);
});

test('raw explains a path the shell rewrote instead of failing as an unreachable host', async () => {
  // What Git Bash does to a leading slash. Parsed, "C:/..." has scheme "c",
  // so it is neither http nor the configured origin.
  const result = await locker(['raw', 'GET', 'C:/Program Files/Git/api/lockers/x'], {
    LOCKER_CODE: 'K7F29QB3',
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /shell rewrote/);
  assert.match(result.stderr, /no leading slash/);
});

test('a destructive command refuses rather than prompting with nobody there', async () => {
  // There has to be something to remove, or the command correctly finishes with
  // nothing to confirm and the gate is never reached.
  await locker(['config', 'set', 'lang', 'en']);

  const refused = await locker(['config', 'clear']);
  assert.equal(refused.code, 2, 'must refuse rather than prompt or proceed');
  assert.match(refused.stderr, /--dry-run|--yes/);

  // And it really did not do it.
  const after = await locker(['config', 'get', '--json']);
  const envelope = JSON.parse(after.stdout) as { data: { stored: { lang?: string } } };
  assert.equal(envelope.data.stored.lang, 'en', 'nothing may be removed by a refused command');

  // --dry-run is the offered alternative, so it has to work without confirming.
  const preview = await locker(['config', 'clear', '--dry-run']);
  assert.equal(preview.code, 0);
  assert.match(preview.stdout, /Would remove/);

  await locker(['config', 'clear', '--yes']);
});
