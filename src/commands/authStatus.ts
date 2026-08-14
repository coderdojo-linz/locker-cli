import type { Command, CommandInput, CommandResult } from '../runtime/command.js';
import type { Context } from '../runtime/context.js';
import { flagSet } from '../runtime/args.js';
import { formatCode, maskCode } from '../runtime/code.js';
import type { LockerDetails } from '../api/types.js';
import { renderPairs } from '../runtime/style.js';

/** Said in words rather than as a key name, because this is the answer to "why that locker?". */
const SOURCES: Record<string, string> = {
  flag: '--code on this command',
  environment: 'the LOCKER_CODE environment variable',
  file: 'saved by locker auth login',
  none: 'nowhere — no code found',
};

/**
 * Which locker this shell is using, and whether the code still works.
 *
 * Every part of the resolution is shown, including where the code came from,
 * because the confusing case is a saved code being quietly overridden by an
 * environment variable — or the reverse. A person should never have to guess
 * which one won.
 */
export async function runAuthStatus(
  context: Context,
  input: CommandInput,
): Promise<CommandResult> {
  const showCode = flagSet(input, 'show-code');

  if (!context.code) {
    context.reporter.warn('No locker code found.', { important: true });
    return {
      human: renderPairs(
        [
          ['host', context.origin],
          ['code', context.palette.dim('none')],
          ['from', SOURCES['none'] as string],
          ['next', 'locker auth login'],
        ],
        context.palette,
      ),
      data: {
        host: context.origin,
        authenticated: false,
        codeSource: context.codeSource,
        locker: null,
      },
    };
  }

  // Checked rather than assumed. A saved code can stop working — the locker was
  // deleted by the retention pass, or the card was replaced at the desk — and
  // "signed in" that has not been verified is worth nothing.
  let locker: LockerDetails | null = null;
  let problem: string | null = null;
  try {
    locker = await context.api.request<LockerDetails>(
      `/api/lockers/${encodeURIComponent(context.code)}`,
      { notFound: { kind: 'credential' } },
    );
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }

  const pairs: [string, string][] = [
    ['host', context.origin],
    ['code', showCode ? formatCode(context.code) : maskCode(context.code)],
    ['from', SOURCES[context.codeSource] ?? context.codeSource],
    ['locker', locker ? locker.name : context.palette.red('does not open a locker')],
  ];
  if (locker) pairs.push(['projects', String(locker.projects.length)]);
  if (problem) pairs.push(['problem', problem]);

  if (!locker) {
    context.reporter.warn('That code does not open a locker on this host.', { important: true });
  }

  return {
    human: renderPairs(pairs, context.palette),
    data: {
      host: context.origin,
      authenticated: locker !== null,
      codeSource: context.codeSource,
      // The code itself is never in the machine output unless it was asked for
      // out loud: `--json` output ends up in logs and CI transcripts.
      ...(showCode ? { code: context.code } : {}),
      locker: locker
        ? { id: locker.id, name: locker.name, projectCount: locker.projects.length }
        : null,
    },
  };
}

const SHOW_CODE_OPTION = {
  'show-code': {
    type: 'boolean' as const,
    description: 'Print the code in full instead of masking it.',
  },
};

export const authStatusCommand: Command = {
  path: ['auth', 'status'],
  summary: 'Which locker and host this shell is using',
  usage: 'locker auth status [--show-code]',
  options: SHOW_CODE_OPTION,
  examples: ['locker auth status', 'locker auth status --json'],
  run: runAuthStatus,
};

/** The name people type out of habit. Same command, kept at the top level. */
export const whoamiCommand: Command = {
  path: ['whoami'],
  summary: 'Which locker and host this shell is using',
  description: 'The same as "locker auth status".',
  usage: 'locker whoami [--show-code]',
  options: SHOW_CODE_OPTION,
  examples: ['locker whoami'],
  run: runAuthStatus,
};
