import { optionalString, requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { shortId } from '../runtime/format.js';
import { fetchLocker, fullName, resolveFile, resolveProject } from '../domain/locker.js';
import { confirm } from '../runtime/prompt.js';

/**
 * Stops a public link working.
 *
 * Destructive in the sense that matters here: somebody may be relying on the
 * address, and there is no way to put the same one back — pressing share again
 * mints a new code.
 */
export const shareRevokeCommand: Command = {
  path: ['share', 'revoke'],
  summary: 'Stop sharing a project or a file',
  description: 'The link stops working straight away. Sharing again gives a different address.',
  usage: 'locker share revoke <project> [--file <file>] [--yes]',
  destructive: true,
  options: {
    file: {
      type: 'string',
      description: 'Stop sharing one file rather than the whole project.',
      placeholder: '<file>',
    },
  },
  examples: [
    'locker share revoke Snake --dry-run',
    'locker share revoke Snake',
    'locker share revoke Snake --file sprite.png',
  ],
  async run(context, input): Promise<CommandResult> {
    const code = context.requireCode();
    const reference = requirePositional(input, 0, 'a project', 'locker share list');

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
        human: [
          `Would stop sharing ${what}.`,
          context.palette.dim('Nothing was changed. Run again without --dry-run to do it.'),
        ].join('\n'),
        data: { dryRun: true, projectId: project.id, fileId: file?.id ?? null },
      };
    }

    await confirm(
      `Stop sharing ${what}, so the link stops working`,
      { reporter: context.reporter, assumeYes: context.assumeYes },
      `locker share revoke ${shortId(project.id)}`,
    );

    await context.api.request(path, {
      method: 'DELETE',
      notFound: {
        kind: 'resource',
        message: `${what} was not shared.`,
        recovery: 'locker share list',
      },
    });

    context.reporter.success(`${what} is no longer shared.`);
    return { human: '', data: { projectId: project.id, fileId: file?.id ?? null, revoked: true } };
  },
};
