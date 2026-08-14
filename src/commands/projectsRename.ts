import { requirePositional } from '../runtime/args.js';
import type { ProjectDetails } from '../api/types.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { usageError } from '../runtime/exit.js';
import { shortId } from '../runtime/format.js';
import { fetchLocker, resolveProject } from '../domain/locker.js';

export const projectsRenameCommand: Command = {
  path: ['projects', 'rename'],
  summary: 'Give a project a different name',
  usage: 'locker projects rename <project> <new name>',
  examples: ['locker projects rename Snake "Snake, but faster"'],
  async run(context, input): Promise<CommandResult> {
    const code = context.requireCode();
    const reference = requirePositional(input, 0, 'a project', 'locker projects list');
    const name = requirePositional(
      input,
      1,
      'a new name',
      'locker projects rename <project> "New name"',
    ).trim();

    if (name.length === 0 || name.length > 120) {
      throw usageError('A project name is between 1 and 120 characters.');
    }

    const locker = await fetchLocker(context);
    const project = resolveProject(locker, reference);

    if (context.dryRun) {
      return {
        human: `Would rename "${project.name}" to "${name}".`,
        data: { dryRun: true, id: project.id, from: project.name, to: name },
      };
    }

    const updated = await context.api.request<ProjectDetails>(
      `/api/lockers/${encodeURIComponent(code)}/projects/${project.id}`,
      {
        method: 'PUT',
        body: { name },
        notFound: {
          kind: 'resource',
          message: `"${project.name}" is no longer in this locker.`,
          recovery: 'locker projects list',
        },
      },
    );

    context.reporter.success(`Renamed to "${updated.name}".`);
    return { human: `${shortId(updated.id)}  ${updated.name}`, data: updated };
  },
};
