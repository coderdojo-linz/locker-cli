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
  const file = credentialsFile(env);
  const existing = load(env);
  writeJsonFile(file, {
    version: 1,
    codes: { ...existing.codes, [origin]: code },
  });
}

/** Returns whether there was anything to forget, so `logout` can say so. */
export function clearStoredCode(origin: string, env?: NodeJS.ProcessEnv): boolean {
  const file = credentialsFile(env);
  const existing = load(env);
  const codes = { ...existing.codes };
  if (!(origin in codes)) return false;

  delete codes[origin];
  if (Object.keys(codes).length === 0) {
    removeJsonFile(file);
    return true;
  }
  writeJsonFile(file, { version: 1, codes });
  return true;
}

export const storedOrigins = (env?: NodeJS.ProcessEnv): string[] =>
  Object.keys(load(env).codes ?? {}).sort();
