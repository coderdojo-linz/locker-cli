import { configFile } from './paths.js';
import { readJsonFile, removeJsonFile, writeJsonFile } from './store.js';

/**
 * The settings a person may reasonably want to stop typing.
 *
 * Everything here is safe to print, safe to commit, and safe to send to somebody
 * debugging a problem. A locker code is none of those and lives in
 * <see cref="credentials.ts"/> instead.
 */
export interface StoredConfig {
  /** The origin every command talks to unless `--host` says otherwise. */
  host?: string;
  /** `human` or `json`. Overridden by `--json` and by LOCKER_OUTPUT. */
  output?: string;
  /** `de` or `en`. Sent as Accept-Language, so the API's own refusals arrive in it. */
  lang?: string;
}

/** Every key `config set` will accept, which is also every key it will print. */
export const CONFIG_KEYS = ['host', 'output', 'lang'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export const isConfigKey = (key: string): key is ConfigKey =>
  (CONFIG_KEYS as readonly string[]).includes(key);

export const readConfig = (env?: NodeJS.ProcessEnv): StoredConfig =>
  readJsonFile<StoredConfig>(configFile(env), {});

/** Setting a key to undefined removes it, so `config set` and `config clear` share one path. */
export function writeConfig(patch: StoredConfig, env?: NodeJS.ProcessEnv): StoredConfig {
  const merged: StoredConfig = { ...readConfig(env), ...patch };
  for (const key of CONFIG_KEYS) {
    if (merged[key] === undefined || merged[key] === '') delete merged[key];
  }

  if (Object.keys(merged).length === 0) {
    removeJsonFile(configFile(env));
    return merged;
  }
  // Not 0600: nothing in here is secret, and a config a person cannot read in
  // their own editor is an obstacle rather than a protection.
  writeJsonFile(configFile(env), merged, 0o644);
  return merged;
}
