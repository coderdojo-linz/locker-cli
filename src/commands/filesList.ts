import { requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { formatBytes, formatDate, shortId } from '../runtime/format.js';
import { fetchLocker, fullName, resolveProject } from '../domain/locker.js';
import { renderTable } from '../runtime/style.js';

export const filesListCommand: Command = {
  path: ['files', 'list'],
  summary: 'List the files in one project',
  usage: 'locker files list <project>',
  examples: ['locker files list Snake', 'locker files list Snake --json'],
  async run(context, input): Promise<CommandResult> {
    const reference = requirePositional(input, 0, 'a project', 'locker projects list');
    const locker = await fetchLocker(context);
    const project = resolveProject(locker, reference);

    if (project.files.length === 0) {
      return { human: `"${project.name}" is empty.`, data: [] };
    }

    return {
      human: renderTable(
        [
          { header: 'id', max: 10 },
          { header: 'file', max: 50 },
          { header: 'size', align: 'right' },
          { header: 'link' },
          { header: 'uploaded' },
        ],
        project.files.map((file) => [
          shortId(file.id),
          fullName(file),
          file.externalUrl ? 'link' : formatBytes(file.size),
          file.shareCode ?? '',
          formatDate(file.uploadedAt),
        ]),
        context.palette,
      ),
      data: project.files,
    };
  },
};
