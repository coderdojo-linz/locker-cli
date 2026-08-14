import { parseArgs, type ParseArgsConfig } from 'node:util';
import { GLOBAL_OPTIONS, type Command, type CommandInput, type OptionSpec } from './command.js';
import { usageError } from './exit.js';
import type { GlobalFlags } from './context.js';

/**
 * Turning a command line into a command and its input.
 *
 * The command is found first, by walking the leading words, and only then are
 * the flags parsed — against that command's own options plus the global ones.
 * Doing it the other way round would mean either accepting every flag
 * everywhere, or not knowing which flags are legal until it is too late to say
 * so.
 */

export interface ParsedCommandLine {
  command: Command | null;
  /** The words that named the command, for help and error messages. */
  matchedPath: string[];
  input: CommandInput;
  flags: GlobalFlags;
  wantsHelp: boolean;
  wantsVersion: boolean;
}

/**
 * Matches the longest command path the arguments begin with.
 *
 * Longest wins so that `projects list` is preferred over a hypothetical
 * `projects`, and the scan stops at the first thing that looks like a flag so
 * that `--host` is never mistaken for a subcommand name.
 */
function findCommand(argv: string[], commands: Command[]): { command: Command | null; depth: number } {
  const words: string[] = [];
  for (const argument of argv) {
    if (argument.startsWith('-')) break;
    words.push(argument);
  }

  let best: Command | null = null;
  let depth = 0;
  for (const command of commands) {
    const { path } = command;
    if (path.length > words.length || path.length < depth) continue;
    if (path.every((segment, index) => words[index] === segment)) {
      best = command;
      depth = path.length;
    }
  }
  return { command: best, depth };
}

const toParseArgsOptions = (
  options: Record<string, OptionSpec>,
): NonNullable<ParseArgsConfig['options']> =>
  Object.fromEntries(
    Object.entries(options).map(([name, spec]) => [
      name,
      {
        type: spec.type,
        ...(spec.short ? { short: spec.short } : {}),
        ...(spec.multiple ? { multiple: true } : {}),
      },
    ]),
  );

export function parseCommandLine(argv: string[], commands: Command[]): ParsedCommandLine {
  const { command, depth } = findCommand(argv, commands);

  // Global names win a collision, so `--json` cannot be quietly redefined by one
  // command into meaning something else.
  const specs: Record<string, OptionSpec> = { ...(command?.options ?? {}), ...GLOBAL_OPTIONS };

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: toParseArgsOptions(specs),
      allowPositionals: true,
      strict: true,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const name = command ? ['locker', ...command.path].join(' ') : 'locker';
    throw usageError(message, `${name} --help`);
  }

  const values = parsed.values as Record<string, unknown>;
  const verbose = Array.isArray(values['verbose']) ? values['verbose'].length : 0;

  return {
    command,
    matchedPath: command?.path ?? [],
    // The words that named the command are not arguments to it.
    input: { positionals: parsed.positionals.slice(depth), values },
    flags: {
      host: asString(values['host']),
      code: asString(values['code']),
      json: values['json'] === true,
      output: asString(values['output']),
      'no-json': values['no-json'] === true,
      lang: asString(values['lang']),
      quiet: values['quiet'] === true,
      verbose,
      'no-color': values['no-color'] === true,
      yes: values['yes'] === true,
      'dry-run': values['dry-run'] === true,
    },
    wantsHelp: values['help'] === true,
    wantsVersion: values['version'] === true,
  };
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Positional arguments, with a worded refusal instead of an undefined. */
export function requirePositional(
  input: CommandInput,
  index: number,
  what: string,
  usage: string,
): string {
  const value = input.positionals[index];
  if (value === undefined || value.trim().length === 0) {
    throw usageError(`This needs ${what}.`, usage);
  }
  return value;
}

export const optionalString = (input: CommandInput, name: string): string | undefined => {
  const value = input.values[name];
  return typeof value === 'string' ? value : undefined;
};

export const flagSet = (input: CommandInput, name: string): boolean => input.values[name] === true;

/** A numeric option, refused rather than silently coerced when it is not a number. */
export function numberOption(input: CommandInput, name: string): number | undefined {
  const raw = optionalString(input, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw usageError(`--${name} takes a number, not "${raw}".`);
  return value;
}
