import type { AuthenticatedMentor } from '../api/types.js';
import { flagSet } from '../runtime/args.js';
import { ApiClient } from '../runtime/api.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { writeStoredKey } from '../runtime/credentials.js';
import { usageError } from '../runtime/exit.js';
import { credentialsFile } from '../runtime/paths.js';
import { askSecret, canPrompt, readStdin } from '../runtime/prompt.js';

/**
 * Remembers an API key for this host.
 *
 * A locker code opens one locker and belongs to a child. A key stands in for
 * somebody at the desk and opens whatever its role reaches — every locker in the
 * installation, for a mentor key — so it is the more dangerous of the two and is
 * asked for the same careful way: never as an argument by default, because a
 * command line ends up in the shell's history and in the output of `ps`.
 *
 * Most of the time nothing should be saved at all. A key belongs to a program
 * more often than to a person, and a program should carry it in the environment:
 *
 *   LOCKER_API_KEY=locker_… locker admin lockers list
 */
export const authKeyCommand: Command = {
  path: ['auth', 'key'],
  summary: 'Remember an API key for the desk commands',
  description:
    'Checks the key works on this host, then saves it for next time.\n\n' +
    'In a script, do not save anything — put it in the environment instead:\n' +
    '  LOCKER_API_KEY=locker_… locker admin lockers list',
  usage: 'locker auth key [--key-stdin]',
  options: {
    'key-stdin': {
      type: 'boolean',
      description: 'Read the key from standard input instead of asking for it.',
    },
    'no-validate': {
      type: 'boolean',
      description: 'Save the key without checking it reaches anything.',
    },
  },
  examples: [
    'locker auth key',
    'echo "$LOCKER_API_KEY" | locker auth key --key-stdin',
  ],
  async run(context, input): Promise<CommandResult> {
    // Deliberately not a positional. A locker code is eight characters a child
    // reads off a card and is fine to type; a key is a secret, and one typed as
    // an argument is in the shell history for ever.
    const key = (await collectKey(context, flagSet(input, 'key-stdin'))).trim();
    if (key.length === 0) throw usageError('No key was given.', 'locker auth key');

    if (context.dryRun) {
      return {
        human: `Would remember a key for ${context.origin}.`,
        data: { dryRun: true, origin: context.origin },
      };
    }

    let mentor: AuthenticatedMentor | null = null;
    if (!flagSet(input, 'no-validate')) {
      // Asked with the key just given rather than with whatever the context
      // resolved, so that checking a new key is not answered by an old one.
      const trying = new ApiClient(
        context.origin,
        context.language,
        context.reporter,
        context.diagnostics,
        () => 'locker-cli-auth-key',
        key,
      );
      mentor = await trying.request<AuthenticatedMentor>('/api/auth/me', {
        notFound: { kind: 'credential' },
      });
    }

    writeStoredKey(context.origin, key);
    context.reporter.success(
      mentor
        ? `Saved. This key reaches ${context.origin} as ${mentor.role}.`
        : `Saved a key for ${context.origin}, unchecked.`,
    );
    context.reporter.note(`Kept in ${credentialsFile()}`);

    return {
      human: '',
      data: { origin: context.origin, role: mentor?.role ?? null, saved: true },
    };
  },
};

/** Standard input for a script, a hidden prompt for a person, and nothing else. */
async function collectKey(
  context: Parameters<NonNullable<Command['run']>>[0],
  fromStdin: boolean,
): Promise<string> {
  if (fromStdin) return readStdin();
  if (!canPrompt(context.reporter)) {
    throw usageError(
      'Nothing to read the key from.',
      'echo "$LOCKER_API_KEY" | locker auth key --key-stdin',
    );
  }
  return askSecret('API key: ');
}
