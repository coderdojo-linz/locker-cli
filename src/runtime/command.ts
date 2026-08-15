import type { Context } from './context.js';

export interface OptionSpec {
  type: 'string' | 'boolean';
  short?: string;
  multiple?: boolean;
  description: string;
  /** Shown in help as `--out <dir>`. Omitted for booleans. */
  placeholder?: string;
  /**
   * Accepted, but left out of help. For a spelling that has been superseded and
   * still has to work: a script written last term, or a README somebody printed.
   * Documenting both would put the old name back in front of new readers.
   */
  hidden?: boolean;
}

/**
 * What a command produces.
 *
 * The two representations are returned together, always, and the runtime picks
 * one. That is the mechanism behind "human output is the default and `--json` is
 * opt-in": a command physically cannot print JSON by accident, because it never
 * writes to stdout itself — and it cannot forget the human rendering either,
 * because the type requires it.
 */
export interface CommandResult {
  /** Rendered for a person. Empty means the command's stderr note said it all. */
  human: string;
  /** The same answer as data, for `--json`. Field names match the API's. */
  data: unknown;
}

export interface CommandInput {
  positionals: string[];
  values: Record<string, unknown>;
}

export interface Command {
  /** `['projects', 'list']`. The first element groups it in help. */
  path: string[];
  summary: string;
  description?: string;
  usage: string;
  options?: Record<string, OptionSpec>;
  examples?: string[];
  /** Marked in help, and gated behind a confirmation or `--yes`. */
  destructive?: boolean;
  /** Kept discoverable but visually secondary in help. */
  expert?: boolean;
  run(context: Context, input: CommandInput): Promise<CommandResult>;
}

/**
 * Flags every command understands.
 *
 * Reserved names only, with the meanings they have everywhere else: `-v` is
 * verbosity and never version, `--json` is machine output and never pretty
 * printing, `--dry-run` never mutates.
 */
export const GLOBAL_OPTIONS: Record<string, OptionSpec> = {
  host: {
    type: 'string',
    description: 'Locker server to talk to. Defaults to locker.coderdojo.net.',
    placeholder: '<host>',
  },
  code: {
    type: 'string',
    description: 'Locker code for this command only. Never saved.',
    placeholder: '<code>',
  },
  key: {
    type: 'string',
    description: 'API key for this command only. Never saved. Or set LOCKER_API_KEY.',
    placeholder: '<key>',
  },
  json: { type: 'boolean', description: 'Machine-readable output (schema v1).' },
  output: {
    type: 'string',
    description: 'human or json. --json is the short way to say json.',
    placeholder: '<mode>',
  },
  'no-json': { type: 'boolean', description: 'Force human output, overriding LOCKER_OUTPUT.' },
  lang: { type: 'string', description: 'de or en. The server answers in it.', placeholder: '<lang>' },
  yes: { type: 'boolean', short: 'y', description: 'Answer confirmations with yes.' },
  'dry-run': { type: 'boolean', description: 'Show what would happen, change nothing.' },
  quiet: { type: 'boolean', description: 'No progress or status chatter. Never prompts.' },
  verbose: { type: 'boolean', short: 'v', multiple: true, description: 'More detail on stderr. Repeat for more.' },
  'no-color': { type: 'boolean', description: 'No colour. NO_COLOR is honoured too.' },
  help: { type: 'boolean', short: 'h', description: 'Show help for this command.' },
  version: { type: 'boolean', short: 'V', description: 'Show the version.' },
};

/** A result with nothing to print, for commands whose whole answer is their exit code. */
export const silent = (data: unknown = null): CommandResult => ({ human: '', data });
