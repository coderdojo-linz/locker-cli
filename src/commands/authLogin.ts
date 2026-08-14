import type { LockerDetails } from '../api/types.js';
import { flagSet } from '../runtime/args.js';
import { codeProblem, maskCode, normalizeCode } from '../runtime/code.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { writeStoredCode } from '../runtime/credentials.js';
import { usageError } from '../runtime/exit.js';
import { credentialsFile } from '../runtime/paths.js';
import { askSecret, canPrompt, readStdin } from '../runtime/prompt.js';

/**
 * The one command that writes a locker code to disk.
 *
 * Nothing else saves a credential, however successfully it used one. On a Dojo
 * laptop the next child to sit down would otherwise inherit the last one's
 * locker without either of them realising, so remembering a code is always
 * something a person asked for out loud.
 */
export const authLoginCommand: Command = {
  path: ['auth', 'login'],
  summary: 'Enter a locker code and remember it',
  description:
    'Checks the code opens a locker on this host, then saves it for next time.\n\n' +
    'On a shared computer, prefer not saving anything at all:\n' +
    '  LOCKER_CODE=K7F29QB3 locker status',
  usage: 'locker auth login [code] [--code-stdin]',
  options: {
    'code-stdin': {
      type: 'boolean',
      description: 'Read the code from standard input instead of asking for it.',
    },
    'no-validate': {
      type: 'boolean',
      description: 'Save the code without checking it opens anything.',
    },
  },
  examples: [
    'locker auth login',
    'locker auth login "K7F2 9QB3"',
    'echo "K7F29QB3" | locker auth login --code-stdin',
  ],
  async run(context, input): Promise<CommandResult> {
    const raw = await collectCode(context, input.positionals[0], flagSet(input, 'code-stdin'));
    const code = normalizeCode(raw);

    const problem = codeProblem(code);
    if (problem) throw usageError(problem, 'locker auth login');

    let locker: LockerDetails | null = null;
    if (!flagSet(input, 'no-validate')) {
      // Nothing is saved until it is known to work. Saving first would leave a
      // typo on disk that reports itself as a broken locker on every later
      // command.
      locker = await context.api.request<LockerDetails>(
        `/api/lockers/${encodeURIComponent(code)}`,
        { notFound: { kind: 'credential' } },
      );
    }

    if (context.dryRun) {
      return {
        human: `Would save ${maskCode(code)} for ${context.origin}.`,
        data: { dryRun: true, host: context.origin, locker: locker?.name ?? null },
      };
    }

    writeStoredCode(context.origin, code);
    context.reporter.success(
      locker
        ? `Signed in to ${locker.name} at ${context.origin}.`
        : `Saved ${maskCode(code)} for ${context.origin} without checking it.`,
    );
    context.reporter.note(context.palette.dim(`Saved in ${credentialsFile()}`));

    return {
      human: '',
      data: {
        host: context.origin,
        saved: true,
        locker: locker ? { id: locker.id, name: locker.name } : null,
      },
    };
  },
};

/**
 * Where the code comes from, in the order a person would expect.
 *
 * Standard input is only ever read when `--code-stdin` says so. A command that
 * reads stdin because an argument happened to be missing hangs in a pipeline
 * and looks like a crash.
 */
async function collectCode(
  context: Parameters<Command['run']>[0],
  positional: string | undefined,
  fromStdin: boolean,
): Promise<string> {
  if (fromStdin) {
    const piped = await readStdin();
    if (piped.length === 0) throw usageError('Nothing arrived on standard input.');
    return piped;
  }
  if (positional && positional.trim().length > 0) return positional;
  // A code already given by --code or LOCKER_CODE is what login should save;
  // asking again would be pedantic.
  if (context.code) return context.code;

  if (!canPrompt(context.reporter)) {
    throw usageError(
      'A locker code is needed, and there is nobody to ask.',
      'locker auth login <code>   (or --code-stdin)',
    );
  }
  return askSecret(`Locker code for ${context.origin}: `);
}
