import { requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { formatBytes, shortId } from '../runtime/format.js';
import { fetchLocker, fullName, resolveFile, resolveProject } from '../domain/locker.js';
import { confirm } from '../runtime/prompt.js';

export const filesDeleteCommand: Command = {
  path: ['files', 'delete'],
  summary: 'Delete one file from a project',
  description: 'This cannot be undone. The project itself stays.',
  usage: 'locker files delete <project> <file> [--yes]',
  destructive: true,
  examples: [
    'locker files delete Snake sprite.png --dry-run',
    'locker files delete Snake sprite.png',
  ],
  async run(context, input): Promise<CommandResult> {
    const code = context.requireCode();
    const projectReference = requirePositional(input, 0, 'a project', 'locker projects list');
    const fileReference = requirePositional(
      input,
      1,
      'a file to delete',
      `locker files list ${projectReference}`,
    );

    const locker = await fetchLocker(context);
    const project = resolveProject(locker, projectReference);
    const file = resolveFile(project, fileReference);
    const describe = `"${fullName(file)}"${file.externalUrl ? '' : ` (${formatBytes(file.size)})`}`;

    if (context.dryRun) {
      return {
        human: [
          `Would delete ${describe} from "${project.name}".`,
          context.palette.dim('Nothing was deleted. Run again without --dry-run to do it.'),
        ].join('\n'),
        data: { dryRun: true, projectId: project.id, fileId: file.id, name: fullName(file) },
      };
    }

    await confirm(
      `Delete ${describe} from "${project.name}"`,
      { reporter: context.reporter, assumeYes: context.assumeYes },
      `locker files delete ${shortId(project.id)} ${shortId(file.id)}`,
    );

    await context.api.request(
      `/api/lockers/${encodeURIComponent(code)}/projects/${project.id}/files/${file.id}`,
      {
        method: 'DELETE',
        notFound: {
          kind: 'resource',
          message: `${describe} was already gone.`,
          recovery: `locker files list ${shortId(project.id)}`,
        },
      },
    );

    context.reporter.success(`Deleted ${describe}.`);
    return { human: '', data: { projectId: project.id, fileId: file.id, deleted: true } };
  },
};
