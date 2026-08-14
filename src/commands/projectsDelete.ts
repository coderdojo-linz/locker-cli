import { requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { formatBytes, pluralize, shortId } from '../runtime/format.js';
import { fetchLocker, resolveProject } from '../domain/locker.js';
import { confirm } from '../runtime/prompt.js';

/**
 * Removes a project and every file in it.
 *
 * There is no undo and no recycle bin: the API deletes the stored bytes with the
 * row. So the confirmation is real, `--dry-run` is offered first, and in a
 * script neither prompt nor guess — it refuses until `--yes` says otherwise.
 */
export const projectsDeleteCommand: Command = {
  path: ['projects', 'delete'],
  summary: 'Delete a project and its files',
  description: 'This cannot be undone. The files are removed from storage as well.',
  usage: 'locker projects delete <project> [--yes]',
  destructive: true,
  examples: [
    'locker projects delete Snake --dry-run',
    'locker projects delete Snake',
    'locker projects delete 3f2a1b4c --yes',
  ],
  async run(context, input): Promise<CommandResult> {
    const code = context.requireCode();
    const reference = requirePositional(input, 0, 'a project to delete', 'locker projects list');

    const locker = await fetchLocker(context);
    const project = resolveProject(locker, reference);
    const totalBytes = project.files.reduce((total, file) => total + file.size, 0);
    const describe = `"${project.name}" (${pluralize(project.files.length, 'file')}, ${formatBytes(
      totalBytes,
    )})`;

    if (context.dryRun) {
      return {
        human: [
          `Would delete ${describe}.`,
          ...project.files.map((file) => `  ${file.name}`),
          context.palette.dim('Nothing was deleted. Run again without --dry-run to do it.'),
        ].join('\n'),
        data: {
          dryRun: true,
          id: project.id,
          name: project.name,
          fileCount: project.files.length,
          totalBytes,
        },
      };
    }

    await confirm(
      `Delete ${describe}`,
      { reporter: context.reporter, assumeYes: context.assumeYes },
      `locker projects delete ${shortId(project.id)}`,
    );

    await context.api.request(
      `/api/lockers/${encodeURIComponent(code)}/projects/${project.id}`,
      {
        method: 'DELETE',
        notFound: {
          kind: 'resource',
          message: `"${project.name}" was already gone.`,
          recovery: 'locker projects list',
        },
      },
    );

    context.reporter.success(`Deleted ${describe}.`);
    return { human: '', data: { id: project.id, name: project.name, deleted: true } };
  },
};
