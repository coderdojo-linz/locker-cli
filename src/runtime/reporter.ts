import type { CliError } from './exit.js';
import { Palette } from './style.js';

export type OutputMode = 'human' | 'json';

/** The one machine contract this CLI promises. Bumped only for a breaking change. */
export const SCHEMA_VERSION = 1;

export interface Envelope {
  ok: boolean;
  data: unknown;
  error: {
    kind: string;
    message: string;
    recovery?: string;
    diagnosticLog?: string;
  } | null;
  meta: {
    schemaVersion: number;
    warnings?: string[];
  };
}

/**
 * Everything the CLI says, and which stream it says it on.
 *
 * The rule this type exists to enforce: stdout carries the answer and nothing
 * else. Progress, warnings, prompts and chatter go to stderr in human mode, and
 * in JSON mode they go inside the envelope or nowhere — so `locker projects list
 * --json | jq` is never broken by a warning landing in the middle of it.
 */
export class Reporter {
  private readonly collected: string[] = [];

  constructor(
    readonly mode: OutputMode,
    readonly quiet: boolean,
    readonly palette: Palette,
    readonly verbosity: number,
    private readonly stdout: NodeJS.WritableStream = process.stdout,
    private readonly stderr: NodeJS.WritableStream = process.stderr,
  ) {}

  get isJson(): boolean {
    return this.mode === 'json';
  }

  /** Status chatter. Never in JSON mode, never when quiet. */
  note(message: string): void {
    if (this.isJson || this.quiet) return;
    this.stderr.write(`${message}\n`);
  }

  success(message: string): void {
    this.note(this.palette.green(message));
  }

  /**
   * Something the caller should know but which did not stop the command.
   *
   * Always collected, so JSON callers find it in `meta.warnings` rather than
   * having to scrape stderr. Quiet suppresses the printed copy only when the
   * warning is cosmetic — one that changes which resource was acted on, or says
   * results are partial, is printed regardless.
   */
  warn(message: string, options: { important?: boolean } = {}): void {
    this.collected.push(message);
    if (this.isJson) return;
    if (this.quiet && !options.important) return;
    this.stderr.write(`${this.palette.yellow('warning')} ${message}\n`);
  }

  /** Detail for a person debugging, gated behind -v/-vv/-vvv. Never on stdout. */
  debug(level: number, message: string): void {
    if (this.verbosity < level || this.quiet) return;
    this.stderr.write(`${this.palette.dim(`[${'v'.repeat(level)}]`)} ${message}\n`);
  }

  get warnings(): string[] {
    return [...this.collected];
  }

  /**
   * A one-line progress display that overwrites itself.
   *
   * Only on a terminal: redirected to a file, a carriage return produces one
   * enormous line, so a non-TTY gets nothing here and relies on the summary.
   */
  progress(message: string): void {
    if (this.isJson || this.quiet) return;
    const stderr = this.stderr as NodeJS.WriteStream;
    if (!stderr.isTTY) return;
    stderr.write(`\r${message.padEnd(stderr.columns ? stderr.columns - 1 : 79).slice(0, (stderr.columns ?? 80) - 1)}`);
  }

  clearProgress(): void {
    if (this.isJson || this.quiet) return;
    const stderr = this.stderr as NodeJS.WriteStream;
    if (!stderr.isTTY) return;
    stderr.write(`\r${' '.repeat((stderr.columns ?? 80) - 1)}\r`);
  }

  /** The answer. The only thing that ever reaches stdout. */
  emit(human: string, data: unknown): void {
    if (this.isJson) {
      this.writeEnvelope({
        ok: true,
        data,
        error: null,
        meta: this.meta(),
      });
      return;
    }
    if (human.length > 0) this.stdout.write(`${human}\n`);
  }

  /**
   * A failure, in whichever contract is in force.
   *
   * In JSON mode this is still stdout and still the envelope: a caller parsing
   * stdout should not have to switch to reading stderr to find out why a command
   * did not work.
   */
  emitError(error: CliError, diagnosticLog?: string): void {
    if (this.isJson) {
      this.writeEnvelope({
        ok: false,
        data: null,
        error: {
          kind: error.kind,
          message: error.message,
          ...(error.recovery ? { recovery: error.recovery } : {}),
          ...(diagnosticLog ? { diagnosticLog } : {}),
        },
        meta: this.meta(),
      });
      return;
    }

    this.stderr.write(`${this.palette.red('error')} ${error.message}\n`);
    if (error.recovery) {
      this.stderr.write(`  ${this.palette.dim('try:')} ${this.palette.cyan(error.recovery)}\n`);
    }
    if (diagnosticLog && !this.quiet) {
      this.stderr.write(`  ${this.palette.dim(`details: ${diagnosticLog}`)}\n`);
    }
  }

  private meta(): Envelope['meta'] {
    return {
      schemaVersion: SCHEMA_VERSION,
      ...(this.collected.length > 0 ? { warnings: this.warnings } : {}),
    };
  }

  private writeEnvelope(envelope: Envelope): void {
    this.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  }
}
