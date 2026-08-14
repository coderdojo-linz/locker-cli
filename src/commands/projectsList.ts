import type { Command, CommandResult } from '../runtime/command.js';
import { formatBytes, formatDate, shortId } from '../runtime/format.js';
import { fetchLocker } from '../domain/locker.js';
import { renderTable } from '../runtime/style.js';

/**
 * Everything in the locker, as a table.
 *
 * A table rather than prose because this is the command whose output gets
 * scanned rather than read: the eye is looking for one project among a dozen.
 */
export const projectsListCommand: Command = {
  path: ['projects', 'list'],
  summary: 'List the projects in the locker',
  usage: 'locker projects list',
  examples: ['locker projects list', 'locker projects list --json'],
  async run(context): Promise<CommandResult> {
    const locker = await fetchLocker(context);

    if (locker.projects.length === 0) {
      context.reporter.note(context.palette.dim('Try: locker upload ./my-project'));
      return { human: 'No projects in this locker yet.', data: [] };
    }

    const rows = locker.projects.map((project) => [
      shortId(project.id),
      project.name,
      String(project.files.length),
      formatBytes(project.files.reduce((total, file) => total + file.size, 0)),
      project.shareCode ? 'shared' : '',
      formatDate(project.createdAt),
    ]);

    return {
      human: renderTable(
        [
          { header: 'id', max: 10 },
          { header: 'project', max: 40 },
          { header: 'files', align: 'right' },
          { header: 'size', align: 'right' },
          { header: 'link' },
          { header: 'created' },
        ],
        rows,
        context.palette,
      ),
      data: locker.projects,
    };
  },
};
