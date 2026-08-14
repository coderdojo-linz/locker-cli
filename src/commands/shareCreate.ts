import { numberOption, optionalString, requirePositional } from '../runtime/args.js';
import type { ProjectShareDetails } from '../api/types.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { usageError } from '../runtime/exit.js';
import { formatDate } from '../runtime/format.js';
import { fetchLocker, fullName, resolveFile, resolveProject } from '../domain/locker.js';
import { renderPairs } from '../runtime/style.js';

/** A minute at the least, three months at the most, which is what the API accepts. */
const MINIMUM_MINUTES = 1;
const MAXIMUM_MINUTES = 60 * 24 * 90;

/**
 * Makes a public address for a project or one file in it.
 *
 * Every link lapses. Leaving `--minutes` out asks for the longest the API
 * allows rather than a link that never dies, because a child's work being
 * reachable forever by anyone holding a URL is not a sensible default.
 */
export const shareCreateCommand: Command = {
  path: ['share', 'create'],
  summary: 'Make a public link to a project or a file',
  description:
    'Anyone with the link can open it until it lapses. Pressing share twice gives\n' +
    'back the same link rather than making a second one.',
  usage: 'locker share create <project> [--file <file>] [--minutes <n>]',
  options: {
    file: { type: 'string', description: 'Share one file instead of the whole project.', placeholder: '<file>' },
    minutes: {
      type: 'string',
      description: `How long the link lasts, ${MINIMUM_MINUTES}-${MAXIMUM_MINUTES}. Defaults to the longest.`,
      placeholder: '<n>',
    },
  },
  examples: [
    'locker share create Snake',
    'locker share create Snake --minutes 60',
    'locker share create Snake --file sprite.png',
  ],
  async run(context, input): Promise<CommandResult> {
    const code = context.requireCode();
    const reference = requirePositional(input, 0, 'a project', 'locker projects list');
    const minutes = numberOption(input, 'minutes');
    if (minutes !== undefined && (minutes < MINIMUM_MINUTES || minutes > MAXIMUM_MINUTES)) {
      throw usageError(`--minutes is between ${MINIMUM_MINUTES} and ${MAXIMUM_MINUTES}.`);
    }

    const locker = await fetchLocker(context);
    const project = resolveProject(locker, reference);
    const fileReference = optionalString(input, 'file');
    const file = fileReference ? resolveFile(project, fileReference) : null;

    const what = file ? `"${fullName(file)}"` : `"${project.name}"`;
    const path = file
      ? `/api/lockers/${encodeURIComponent(code)}/projects/${project.id}/files/${file.id}/share`
      : `/api/lockers/${encodeURIComponent(code)}/projects/${project.id}/share`;

    if (context.dryRun) {
      return {
        human: `Would make a public link to ${what}.`,
        data: { dryRun: true, projectId: project.id, fileId: file?.id ?? null, minutes: minutes ?? null },
      };
    }

    const share = await context.api.request<ProjectShareDetails>(path, {
      method: 'POST',
      body: { minutes: minutes ?? null },
      notFound: {
        kind: 'resource',
        message: `${what} is no longer in this locker.`,
        recovery: 'locker projects list',
      },
    });

    // Built from the host actually in use, so a Dojo on its own instance gets
    // its own address rather than the public one.
    const url = `${context.origin}/s/${share.code}`;
    context.reporter.success(`Anyone with this link can open ${what} until ${formatDate(share.expiresAt)}.`);

    return {
      human: renderPairs(
        [
          ['link', url],
          ['code', share.code],
          ['lapses', formatDate(share.expiresAt)],
        ],
        context.palette,
      ),
      data: { ...share, url, projectId: project.id, fileId: file?.id ?? null },
    };
  },
};
