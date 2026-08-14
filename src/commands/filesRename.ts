import { optionalString, requirePositional } from '../runtime/args.js';
import type { ProjectDetails } from '../api/types.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { shortId } from '../runtime/format.js';
import { fetchLocker, fullName, resolveFile, resolveProject } from '../domain/locker.js';

/**
 * Renames a file, or moves it to another folder in the same project.
 *
 * The file keeps its id, so a share link pointing at it goes on working. That
 * is the reason this exists rather than telling somebody to delete and upload
 * again.
 */
export const filesRenameCommand: Command = {
  path: ['files', 'rename'],
  summary: 'Rename a file, or move it to another folder',
  description:
    'The file keeps its id, so any link to it goes on working.\n' +
    'Use --folder to move it; --folder "" puts it at the top of the project.',
  usage: 'locker files rename <project> <file> <new name> [--folder <path>]',
  options: {
    folder: {
      type: 'string',
      description: 'Move it into this folder. Empty means the top of the project.',
      placeholder: '<path>',
    },
  },
  examples: [
    'locker files rename Snake sprite.png snake-head.png',
    'locker files rename Snake snake-head.png snake-head.png --folder img',
    'locker files rename Snake img/snake-head.png snake-head.png --folder ""',
  ],
  async run(context, input): Promise<CommandResult> {
    const code = context.requireCode();
    const projectReference = requirePositional(input, 0, 'a project', 'locker projects list');
    const fileReference = requirePositional(
      input,
      1,
      'a file to rename',
      `locker files list ${projectReference}`,
    );
    const newName = requirePositional(
      input,
      2,
      'a new name',
      `locker files rename ${projectReference} ${fileReference} <new name>`,
    ).trim();

    const locker = await fetchLocker(context);
    const project = resolveProject(locker, projectReference);
    const file = resolveFile(project, fileReference);

    // Absent means "leave it where it is", which is what a plain rename wants.
    // Passing it empty is how a file is moved back to the top.
    const folder = optionalString(input, 'folder');
    const relativePath = folder === undefined ? file.relativePath : folder.trim() || null;
    const was = fullName(file);
    const becomes = relativePath ? `${relativePath}/${newName}` : newName;

    if (context.dryRun) {
      return {
        human: `Would rename "${was}" to "${becomes}".`,
        data: { dryRun: true, projectId: project.id, fileId: file.id, from: was, to: becomes },
      };
    }

    const updated = await context.api.request<ProjectDetails>(
      `/api/lockers/${encodeURIComponent(code)}/projects/${project.id}/files/${file.id}`,
      {
        method: 'PUT',
        body: { name: newName, relativePath },
        notFound: {
          kind: 'resource',
          message: `"${was}" is no longer in "${project.name}".`,
          recovery: `locker files list ${shortId(project.id)}`,
        },
      },
    );

    context.reporter.success(`Renamed "${was}" to "${becomes}".`);
    return { human: `${shortId(file.id)}  ${becomes}`, data: updated };
  },
};
