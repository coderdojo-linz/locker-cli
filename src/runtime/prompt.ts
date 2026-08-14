import readline from 'node:readline';
import { CliError, Exit, cancelledError } from './exit.js';
import type { Reporter } from './reporter.js';

/**
 * Asking a person something, and refusing to when there is nobody there.
 *
 * The refusal is the important half. A command that blocks on a prompt inside a
 * script or a CI job looks like a hang, so anything that would need an answer
 * checks first and exits with instructions instead.
 */

export interface PromptContext {
  reporter: Reporter;
  /** Set by --yes. Answers every confirmation without asking. */
  assumeYes: boolean;
}

/** Every condition that has to hold before a question may be asked. */
export function canPrompt(reporter: Reporter): boolean {
  return (
    !reporter.isJson &&
    !reporter.quiet &&
    process.stdin.isTTY === true &&
    process.stderr.isTTY === true
  );
}

const refuse = (message: string, recovery: string): CliError =>
  new CliError(message, { kind: 'usage', exitCode: Exit.Usage, recovery });

/**
 * A yes-or-no gate in front of something that cannot be undone.
 *
 * Takes the action as a statement ("Delete X") rather than as a question, so
 * that the same words can be turned into a prompt and into a refusal without
 * either reading like it was assembled from parts.
 *
 * `--dry-run` is offered before `--yes` in the refusal, because the honest first
 * move for somebody scripting a deletion is to look at what it would hit.
 */
export async function confirm(
  action: string,
  context: PromptContext,
  recoveryCommand: string,
): Promise<void> {
  if (context.assumeYes) return;

  if (!canPrompt(context.reporter)) {
    throw refuse(
      `${action} — this needs confirming, and there is nobody here to ask.`,
      `${recoveryCommand} --dry-run   (or --yes to go ahead)`,
    );
  }

  const answer = await ask(`${action}? [y/N] `);
  if (!/^y(es)?$/i.test(answer.trim())) throw cancelledError();
}

/** Prompts go to stderr so that stdout stays exactly the command's answer. */
function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * The control characters the raw-mode reader has to recognise.
 *
 * Built rather than typed. A raw 0x03 sitting in a source file is invisible in
 * every editor and diff, and the difference between it and 0x7f is the
 * difference between "cannot cancel" and "cannot correct a typo".
 */
const KEY = {
  enter: String.fromCharCode(13),
  newline: String.fromCharCode(10),
  interrupt: String.fromCharCode(3),
  backspace: String.fromCharCode(8),
  delete: String.fromCharCode(127),
  space: String.fromCharCode(32),
} as const;

/**
 * Reads a locker code without putting it on screen.
 *
 * Raw mode rather than a readline echo, because a code typed at a Dojo is typed
 * with people behind the chair. Backspace is handled by hand for the same
 * reason readline cannot be used: there is no echo to erase from.
 */
export function askSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) {
      reject(
        refuse(
          'A locker code is needed and this is not a terminal.',
          'locker auth login --code-stdin',
        ),
      );
      return;
    }

    process.stderr.write(question);
    const previousRaw = input.isRaw ?? false;
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    let value = '';
    const done = (finish: () => void): void => {
      input.setRawMode(previousRaw);
      input.pause();
      input.removeListener('data', onData);
      process.stderr.write(KEY.newline);
      finish();
    };

    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === KEY.enter || character === KEY.newline) {
          done(() => resolve(value));
          return;
        }
        // Ctrl-C has to be handled here: raw mode means the terminal no longer
        // turns it into a signal, so without this the prompt cannot be left.
        if (character === KEY.interrupt) {
          done(() => reject(cancelledError()));
          return;
        }
        if (character === KEY.backspace || character === KEY.delete) {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= KEY.space) value += character;
      }
    };

    input.on('data', onData);
  });
}

/** The opt-in, named stdin path. Nothing else in the CLI reads stdin. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}
