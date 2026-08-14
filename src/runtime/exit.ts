/**
 * What the shell learns when the command is over.
 *
 * A script needs to tell "that code is wrong" from "that project is not there"
 * without reading English prose, so every failure the CLI can name gets its own
 * number. The taxonomy is the shared one: 0-2 and 5-6 mean the same in any CLI,
 * and 3, 4, 7, 8 are the service-shaped additions.
 */
export const Exit = {
  Ok: 0,
  /** Something went wrong that none of the other numbers describe. */
  Failure: 1,
  /** Wrong flags, or an answer was needed and nobody could be asked. */
  Usage: 2,
  /** No locker code, or one that opens nothing. */
  NotAuthenticated: 3,
  /** A code that works, for something it may not touch. Unreachable today; see http.ts. */
  NotAuthorized: 4,
  NotFound: 5,
  /** The server had already moved on: a spent ticket, a file uploaded twice. */
  Conflict: 6,
  /** Refused for now rather than forever: the locker is full, or too busy. */
  Throttled: 7,
  /** The server was never reached at all. */
  Transport: 8,
  /** The person said no to a prompt. */
  Cancelled: 10,
} as const;

export type ExitCode = (typeof Exit)[keyof typeof Exit];

/**
 * A stable name for the shape of a failure, for callers reading `--json`.
 *
 * Deliberately not the HTTP status: `404` from the API means "wrong code" in one
 * place and "no such project" in another, and a script should not have to know
 * which endpoint produced it to tell those apart.
 */
export type ErrorKind =
  | 'usage'
  | 'not-authenticated'
  | 'not-authorized'
  | 'not-found'
  | 'validation'
  | 'conflict'
  | 'quota-exceeded'
  | 'rate-limited'
  | 'transport'
  | 'server'
  | 'cancelled'
  | 'failure';

export interface CliErrorOptions {
  kind: ErrorKind;
  exitCode: ExitCode;
  /** The command to run next. Printed under the message, and carried in `error.recovery`. */
  recovery?: string;
  /** Everything worth having in a bug report and nothing worth putting on screen. */
  detail?: unknown;
  cause?: unknown;
}

/**
 * A failure the CLI understands well enough to explain.
 *
 * Anything thrown that is not one of these is a bug, and is reported as one —
 * with a diagnostic file — rather than being dressed up as an expected outcome.
 */
export class CliError extends Error {
  readonly kind: ErrorKind;
  readonly exitCode: ExitCode;
  readonly recovery?: string;
  readonly detail?: unknown;

  constructor(message: string, options: CliErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CliError';
    this.kind = options.kind;
    this.exitCode = options.exitCode;
    this.recovery = options.recovery;
    this.detail = options.detail;
  }
}

export const usageError = (message: string, recovery?: string): CliError =>
  new CliError(message, { kind: 'usage', exitCode: Exit.Usage, recovery });

export const notFoundError = (message: string, recovery?: string): CliError =>
  new CliError(message, { kind: 'not-found', exitCode: Exit.NotFound, recovery });

export const cancelledError = (): CliError =>
  new CliError('Cancelled.', { kind: 'cancelled', exitCode: Exit.Cancelled });
