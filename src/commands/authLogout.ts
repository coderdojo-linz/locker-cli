import type { Command, CommandResult } from '../runtime/command.js';
import { clearStoredCode, storedOrigins } from '../runtime/credentials.js';

/**
 * Forgets the saved code for this host.
 *
 * Not destructive in the sense that needs confirming — nothing in the locker
 * changes, and the code is printed on a card the child is holding. It is kept
 * prominent in help for the opposite reason: on a shared computer it is the
 * thing somebody most needs to find.
 */
export const authLogoutCommand: Command = {
  path: ['auth', 'logout'],
  summary: 'Forget the saved locker code',
  description:
    'Removes the saved code for this host. The locker and everything in it is untouched.\n' +
    'Codes set with --code or LOCKER_CODE were never saved, so there is nothing to remove.',
  usage: 'locker auth logout [--all]',
  options: {
    all: { type: 'boolean', description: 'Forget saved codes for every host, not just this one.' },
  },
  examples: ['locker auth logout', 'locker auth logout --all'],
  async run(context, input): Promise<CommandResult> {
    const everywhere = input.values['all'] === true;
    const targets = everywhere ? storedOrigins() : [context.origin];

    if (context.dryRun) {
      return {
        human:
          targets.length === 0
            ? 'There is nothing saved to forget.'
            : `Would forget the code for:\n${targets.map((origin) => `  ${origin}`).join('\n')}`,
        data: { dryRun: true, hosts: targets },
      };
    }

    const forgotten = targets.filter((origin) => clearStoredCode(origin));

    if (forgotten.length === 0) {
      context.reporter.note(`Nothing was saved for ${everywhere ? 'any host' : context.origin}.`);
    } else {
      context.reporter.success(
        `Forgot the code for ${forgotten.join(', ')}.`,
      );
    }

    // Said only when it is actually the reason a later command will still work,
    // so it reads as an explanation rather than as noise.
    if (context.codeSource === 'environment') {
      context.reporter.warn(
        'LOCKER_CODE is still set in this shell, so commands here will keep using it.',
        { important: true },
      );
    }

    return { human: '', data: { forgotten } };
  },
};
