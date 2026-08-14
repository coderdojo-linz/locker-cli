import fs from 'node:fs';
import path from 'node:path';
import { logsDirectory } from './paths.js';
import { redact, redactDeep, type RedactionSecrets } from './redact.js';

/**
 * The detail that does not belong on screen.
 *
 * An error message answers what failed, why, and what to do next. Everything
 * else — which host was resolved, where the code came from, what the server
 * actually sent back — goes in a file, so a person reporting a problem has
 * something to attach and a person reading the screen is not made to wade
 * through it.
 *
 * The file always holds the deepest level of detail, whatever `-v` was passed.
 * The verbosity flag decides what is echoed to stderr while the command runs,
 * not what is worth keeping afterwards.
 */
export class Diagnostics {
  private readonly lines: string[] = [];
  private secrets: RedactionSecrets = {};

  /** Told to the logger as soon as it is known, so earlier lines are scrubbed too. */
  useSecrets(secrets: RedactionSecrets): void {
    this.secrets = { ...this.secrets, ...secrets };
  }

  record(label: string, detail?: unknown): void {
    const stamp = new Date().toISOString();
    const rendered =
      detail === undefined
        ? ''
        : `\n${JSON.stringify(redactDeep(detail, this.secrets), null, 2)}`;
    this.lines.push(`[${stamp}] ${redact(label, this.secrets)}${rendered}`);
  }

  /**
   * Writes the file and returns where it went, or undefined when it could not
   * be written.
   *
   * A failure here is swallowed on purpose. The command has already failed and
   * is about to say so usefully; replacing that message with "could not write
   * the log about it" would be a worse outcome than having no log.
   */
  write(error: unknown, argv: readonly string[]): string | undefined {
    try {
      const directory = logsDirectory();
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(directory, `locker-error-${stamp}.log`);
      fs.writeFileSync(file, this.render(error, argv), { mode: 0o600, encoding: 'utf8' });
      return file;
    } catch {
      return undefined;
    }
  }

  private render(error: unknown, argv: readonly string[]): string {
    const header = [
      `locker CLI diagnostic`,
      `when:     ${new Date().toISOString()}`,
      // The command line is redacted too: `--code K7F29QB3` would otherwise put
      // the credential on the first line of the file meant for sharing.
      `command:  ${redact(argv.join(' '), this.secrets)}`,
      `platform: ${process.platform} ${process.arch}, node ${process.version}`,
      '',
      'Include this file when reporting a bug. Secrets have been removed.',
      '',
    ].join('\n');

    const failure = [
      '--- error ---',
      redact(errorChain(error), this.secrets),
      '',
      '--- trace ---',
      ...this.lines,
      '',
    ].join('\n');

    return `${header}\n${failure}`;
  }
}

/** Every cause in the chain, so a wrapped network failure still shows its root. */
function errorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current !== undefined && current !== null && depth < 8) {
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      if (current.stack) parts.push(current.stack);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      current = undefined;
    }
    depth += 1;
  }
  return parts.join('\n\ncaused by:\n');
}
