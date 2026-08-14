import { requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { formatBytes, formatDate, shortId } from '../runtime/format.js';
import { fetchLocker, fullName, resolveProject } from '../domain/locker.js';
import { renderPairs, renderTable } from '../runtime/style.js';

export const projectsShowCommand: Command = {
  path: ['projects', 'show'],
  summary: 'Show one project and everything in it',
  usage: 'locker projects show <project>',
  examples: ['locker projects show Snake', 'locker projects show 3f2a1b4c --json'],
  async run(context, input): Promise<CommandResult> {
    const reference = requirePositional(input, 0, 'a project', 'locker projects list');
    const locker = await fetchLocker(context);
    const project = resolveProject(locker, reference);

    const totalBytes = project.files.reduce((total, file) => total + file.size, 0);
    const header = renderPairs(
      [
        ['project', project.name],
        ['id', project.id],
        ['created', formatDate(project.createdAt)],
        ['files', String(project.files.length)],
        ['size', formatBytes(totalBytes)],
        ['link', project.shareCode ?? '—'],
      ],
      context.palette,
    );

    const table = renderTable(
      [
        { header: 'id', max: 10 },
        { header: 'file', max: 50 },
        { header: 'size', align: 'right' },
        { header: 'uploaded' },
      ],
      project.files.map((file) => [
        shortId(file.id),
        fullName(file),
        // A pasted link has no bytes of its own, and a size of "0 B" reads like
        // an upload that went wrong.
        file.externalUrl ? 'link' : formatBytes(file.size),
        formatDate(file.uploadedAt),
      ]),
      context.palette,
    );

    const body = project.files.length === 0 ? context.palette.dim('This project is empty.') : table;
    return { human: `${header}\n\n${body}`, data: project };
  },
};
