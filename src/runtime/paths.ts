import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Where the CLI keeps its own files, following whatever the platform calls
 * "somewhere other than the user's documents".
 *
 * Windows has no XDG convention and `~/.config` there is a Unix habit that
 * leaves a dotted folder in the profile root, so it gets `%APPDATA%`. Everywhere
 * else honours `XDG_CONFIG_HOME` when it is set to an absolute path — a relative
 * one is against the spec and is ignored rather than resolved against the
 * working directory, which would scatter config wherever the CLI was run.
 */
export function configDirectory(
  env: NodeJS.ProcessEnv = process.env,
  // Taken as an argument so both branches can be exercised from either
  // platform. A rule that only runs on the machine it was written on is a rule
  // nobody finds out is wrong until somebody else runs it.
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = env['LOCKER_CONFIG'];
  if (override && override.trim().length > 0) return path.resolve(override);

  if (platform === 'win32') {
    const appData = env['APPDATA'];
    if (appData && appData.trim().length > 0) return path.join(appData, 'locker');
    return path.join(home, 'AppData', 'Roaming', 'locker');
  }

  const xdg = env['XDG_CONFIG_HOME'];
  if (xdg && path.isAbsolute(xdg)) return path.join(xdg, 'locker');
  return path.join(home, '.config', 'locker');
}

export const configFile = (env?: NodeJS.ProcessEnv): string =>
  path.join(configDirectory(env), 'config.json');

/**
 * Kept apart from the general config so that printing, syncing, or pasting the
 * settings file never carries a locker code with it.
 */
export const credentialsFile = (env?: NodeJS.ProcessEnv): string =>
  path.join(configDirectory(env), 'credentials.json');

export const logsDirectory = (env?: NodeJS.ProcessEnv): string =>
  path.join(configDirectory(env), 'logs');
