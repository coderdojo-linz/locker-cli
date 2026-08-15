import { ApiClient } from './api.js';
import { codeProblem, normalizeCode } from './code.js';
import { readConfig } from './config.js';
import { readDeviceKey, readStoredCode } from './credentials.js';
import { Diagnostics } from './diagnostics.js';
import { CliError, Exit, usageError } from './exit.js';
import { Reporter, type OutputMode } from './reporter.js';
import { Palette, colorEnabled } from './style.js';

export const DEFAULT_HOST = 'https://locker.coderdojo.net';
export const DEFAULT_LANGUAGE = 'de';

/** Where the locker code came from. Reported by `auth status`, so nothing is mysterious. */
export type CodeSource = 'flag' | 'environment' | 'file' | 'none';

export interface GlobalFlags {
  host?: string | undefined;
  code?: string | undefined;
  json?: boolean | undefined;
  output?: string | undefined;
  'no-json'?: boolean | undefined;
  lang?: string | undefined;
  quiet?: boolean | undefined;
  verbose?: number | undefined;
  'no-color'?: boolean | undefined;
  yes?: boolean | undefined;
  'dry-run'?: boolean | undefined;
}

export interface Context {
  readonly origin: string;
  readonly code: string | null;
  readonly codeSource: CodeSource;
  readonly language: string;
  readonly api: ApiClient;
  readonly reporter: Reporter;
  readonly diagnostics: Diagnostics;
  readonly palette: Palette;
  readonly assumeYes: boolean;
  readonly dryRun: boolean;
  /** The code, or a refusal that names the command to run. */
  requireCode(): string;
}

/**
 * A hostname, a URL, or something in between, reduced to one comparable origin.
 *
 * The origin is what credentials are filed under, so this has to be stable:
 * "locker.coderdojo.net", "https://Locker.CoderDojo.NET/" and
 * "https://locker.coderdojo.net/desk" must all become one key, or a kid who
 * types the host slightly differently is told they are not signed in.
 *
 * Scheme and port are kept, because a Dojo's own instance on
 * http://localhost:8080 is genuinely a different place from the public one and
 * must not share a code with it.
 */
export function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw usageError('A host cannot be empty.', 'locker status --host locker.coderdojo.net');

  // A bare hostname is the common case at a keyboard, and https is the only
  // sensible assumption for somewhere a locker code is about to be sent.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw usageError(`"${raw}" is not a host the CLI can use.`, 'locker status --host locker.coderdojo.net');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw usageError(`Only http and https hosts work here, not "${url.protocol}".`);
  }
  return url.origin;
}

/**
 * An environment variable that is set to nothing is not set.
 *
 * `LOCKER_HOST=` in a script, or an empty value in a CI settings page, means
 * "no opinion" to everybody who writes one. Taking it literally makes the CLI
 * refuse to run over a variable somebody cleared on purpose.
 */
const fromEnvironment = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name];
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
};

/**
 * Settles the output mode before anything else, because it decides whether a
 * question may be asked at all.
 *
 * Combining a human selector with a machine one is refused rather than resolved:
 * either could plausibly be the one meant, and guessing would send output
 * somewhere a script was not expecting.
 */
function resolveOutput(flags: GlobalFlags, env: NodeJS.ProcessEnv, configured?: string): OutputMode {
  const wantsHuman = flags['no-json'] === true || flags.output === 'human';
  const wantsJson = flags.json === true || flags.output === 'json';

  if (wantsHuman && wantsJson) {
    throw usageError(
      'Asked for human output and JSON output at the same time.',
      'locker <command> --json',
    );
  }
  if (flags.output !== undefined && flags.output !== 'human' && flags.output !== 'json') {
    throw usageError(`--output takes "human" or "json", not "${flags.output}".`);
  }
  if (wantsJson) return 'json';
  if (wantsHuman) return 'human';

  const environment = fromEnvironment(env, 'LOCKER_OUTPUT')?.toLowerCase();
  if (environment === 'json' || environment === 'human') return environment;

  if (configured === 'json' || configured === 'human') return configured;
  return 'human';
}

const resolveLanguage = (flags: GlobalFlags, env: NodeJS.ProcessEnv, configured?: string): string => {
  const chosen = flags.lang ?? fromEnvironment(env, 'LOCKER_LANG') ?? configured ?? DEFAULT_LANGUAGE;
  const normalized = chosen.trim().toLowerCase();
  // Only the two the API actually serves. Anything else would fall back to
  // German at the server anyway, and claiming otherwise here would be a lie.
  return normalized === 'en' ? 'en' : 'de';
};

/**
 * Flags, then environment, then the saved file, then the built-in default —
 * the same order for every setting, with no exceptions.
 */
export function createContext(flags: GlobalFlags, env: NodeJS.ProcessEnv = process.env): Context {
  const config = readConfig(env);

  const mode = resolveOutput(flags, env, config.output);
  const palette = new Palette(colorEnabled(process.stdout, flags['no-color'] === true, env));
  const reporter = new Reporter(
    mode,
    flags.quiet === true,
    palette,
    flags.verbose ?? 0,
  );
  const diagnostics = new Diagnostics();

  const origin = normalizeOrigin(
    flags.host ?? fromEnvironment(env, 'LOCKER_HOST') ?? config.host ?? DEFAULT_HOST,
  );
  const language = resolveLanguage(flags, env, config.lang);

  const { code, codeSource } = resolveCode(flags, env, origin);
  diagnostics.useSecrets({ code });
  diagnostics.record(`resolved host ${origin} (code from ${codeSource})`);

  // Memoised: the first command that talks to a locker mints and stores a key,
  // and every later one reuses it. Lazy, so `--help` writes no file.
  let deviceKey: string | null = null;
  const api = new ApiClient(origin, language, reporter, diagnostics, () => {
    deviceKey ??= readDeviceKey(origin, env);
    return deviceKey;
  });

  return {
    origin,
    code,
    codeSource,
    language,
    api,
    reporter,
    diagnostics,
    palette,
    assumeYes: flags.yes === true,
    dryRun: flags['dry-run'] === true,
    requireCode(): string {
      if (code) return code;
      throw new CliError('No locker code. The CLI does not know which locker to open.', {
        kind: 'not-authenticated',
        exitCode: Exit.NotAuthenticated,
        recovery: 'locker auth login',
      });
    },
  };
}

/**
 * The environment beats the saved file on purpose.
 *
 * A Dojo laptop is shared. `LOCKER_CODE=... locker upload ...` has to win over
 * whatever the last child left saved, and it has to leave nothing behind.
 */
function resolveCode(
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv,
  origin: string,
): { code: string | null; codeSource: CodeSource } {
  const fromFlag = flags.code?.trim();
  if (fromFlag) return { code: check(fromFlag, '--code'), codeSource: 'flag' };

  const environment = fromEnvironment(env, 'LOCKER_CODE');
  if (environment) return { code: check(environment, 'LOCKER_CODE'), codeSource: 'environment' };

  const stored = readStoredCode(origin, env);
  if (stored) return { code: normalizeCode(stored), codeSource: 'file' };

  return { code: null, codeSource: 'none' };
}

/** A typo is caught here rather than spent on a request that would 404. */
function check(raw: string, source: string): string {
  const code = normalizeCode(raw);
  const problem = codeProblem(code);
  if (problem) throw usageError(`${problem} (from ${source})`, 'locker auth login');
  return code;
}
