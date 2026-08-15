import { randomBytes } from 'node:crypto';
import { credentialsFile } from './paths.js';
import { readJsonFile, removeJsonFile, writeJsonFile } from './store.js';

/**
 * Where a locker code is kept between commands.
 *
 * Codes are stored against the origin they open, never globally: a Dojo running
 * its own instance and the public one are different places, and a code from one
 * must not be quietly spent on the other.
 *
 * This file, not the config file, and mode 0600. A locker code is a full
 * read-and-write credential — the API asks for nothing else — so it is kept
 * where `config get` cannot print it and a pasted settings file cannot carry it.
 *
 * An operating-system keychain would protect it better. It is not used because
 * every binding for one is a native module, and a native module is the thing
 * most likely to make `npx` fail on the locked-down laptop at a Dojo. That is a
 * trade, and it is written down here rather than left to look like an oversight:
 * anyone who can read the user's profile can read this file.
 */

interface CredentialsFileShape {
  version?: number;
  codes?: Record<string, string>;
  devices?: Record<string, string>;
  keys?: Record<string, string>;
}

const load = (env?: NodeJS.ProcessEnv): CredentialsFileShape =>
  readJsonFile<CredentialsFileShape>(credentialsFile(env), {});

/** The code saved for one origin, or null when `auth login` has not been run for it. */
export function readStoredCode(origin: string, env?: NodeJS.ProcessEnv): string | null {
  const codes = load(env).codes;
  if (!codes) return null;
  const stored = codes[origin];
  return typeof stored === 'string' && stored.length > 0 ? stored : null;
}

/**
 * Only `auth login` calls this.
 *
 * No command writes a credential just because it happened to be given one that
 * worked. On a Dojo laptop the next child to sit down would inherit the last
 * one's locker, and they would have no reason to suspect it.
 */
export function writeStoredCode(origin: string, code: string, env?: NodeJS.ProcessEnv): void {
  const existing = load(env);
  writeJsonFile(credentialsFile(env), {
    ...existing,
    version: 1,
    codes: { ...existing.codes, [origin]: code },
  });
}

/**
 * The key a mentor's own tooling authenticates with, kept the same way a code is.
 *
 * A locker code opens one locker; a key stands in for somebody at the desk and
 * opens whatever its role reaches. It is the more dangerous of the two, which is
 * the argument for keeping it here beside the code rather than in the config
 * file: `config show` does not print this, and a settings file pasted into a
 * chat does not carry it.
 */
export function readStoredKey(origin: string, env?: NodeJS.ProcessEnv): string | null {
  const stored = load(env).keys?.[origin];
  return typeof stored === 'string' && stored.length > 0 ? stored : null;
}

export function writeStoredKey(origin: string, key: string, env?: NodeJS.ProcessEnv): void {
  const existing = load(env);
  writeJsonFile(credentialsFile(env), {
    ...existing,
    version: 1,
    keys: { ...existing.keys, [origin]: key },
  });
}

/** Returns whether there was a key to forget, so `auth logout` can say so. */
export function clearStoredKey(origin: string, env?: NodeJS.ProcessEnv): boolean {
  const existing = load(env);
  const keys = { ...existing.keys };
  if (!(origin in keys)) return false;

  delete keys[origin];
  writeJsonFile(credentialsFile(env), { ...existing, version: 1, keys });
  return true;
}

/**
 * The key that says a later command is the same person as the upload.
 *
 * At a Dojo that has a mentor look at work before anybody else can, the child
 * who saved something may still open it while it waits. In a browser that is a
 * cookie; here it has to be kept, because a terminal has no cookie jar.
 *
 * Minted on first use and then reused, per origin like the code beside it. It is
 * not a credential to anything on its own — without the locker code it opens
 * nothing — but it lives in this file rather than in the config so that
 * `config show` does not print it and a pasted settings file does not carry it.
 */
export function readDeviceKey(origin: string, env?: NodeJS.ProcessEnv): string {
  const existing = load(env);
  const stored = existing.devices?.[origin];
  if (typeof stored === 'string' && stored.length > 0) return stored;

  const minted = randomBytes(16).toString('base64url');
  // Spread what is already there rather than rebuilding from the two fields
  // this function knows about. Written out by hand, adding a third kind of
  // credential to the file meant every writer that had not heard of it quietly
  // deleted it — which looked exactly like a key that had never saved.
  writeJsonFile(credentialsFile(env), {
    ...existing,
    version: 1,
    devices: { ...existing.devices, [origin]: minted },
  });
  return minted;
}

/** Returns whether there was anything to forget, so `logout` can say so. */
export function clearStoredCode(origin: string, env?: NodeJS.ProcessEnv): boolean {
  const file = credentialsFile(env);
  const existing = load(env);
  const codes = { ...existing.codes };
  if (!(origin in codes)) return false;

  delete codes[origin];
  // The device key goes with it. Logging out on a shared Dojo laptop has to
  // leave nothing behind, and a key that outlived the code would let the next
  // child's `locker` see work the last one had waiting for review.
  const devices = { ...existing.devices };
  delete devices[origin];
  // An API key is not the locker code and is not forgotten by this: it belongs
  // to a mentor's tooling rather than to whoever is sitting here, and `auth
  // logout --key` is how it goes.
  const keys = existing.keys ?? {};
  if (Object.keys(codes).length === 0 && Object.keys(devices).length === 0 &&
      Object.keys(keys).length === 0) {
    removeJsonFile(file);
    return true;
  }
  writeJsonFile(file, { version: 1, codes, devices, keys });
  return true;
}

export const storedOrigins = (env?: NodeJS.ProcessEnv): string[] =>
  Object.keys(load(env).codes ?? {}).sort();
