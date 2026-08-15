import { requirePositional } from '../runtime/args.js';
import type { ProjectDetails } from '../api/types.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { usageError } from '../runtime/exit.js';
import { shortId } from '../runtime/format.js';
import { fetchLocker, findProject } from '../domain/locker.js';

const MAXIMUM_NAME_LENGTH = 120;

/**
 * Makes a project with nothing in it yet.
 *
 * `upload` only ever adds to a project that is already there, so this is where
 * one begins. Two commands rather than one for a first upload, on purpose: it
 * means a mistyped `--project` is a refusal rather than a second project named
 * after the typo, and the moment a name is invented is a moment somebody chose
 * rather than a side effect of putting a file somewhere.
 */
export const projectsCreateCommand: Command = {
  path: ['projects', 'create'],
  summary: 'Make an empty project to upload into',
  description:
    'Makes a project with nothing in it. Put files in it with\n' +
    '"locker upload <paths...> --project <name>".',
  usage: 'locker projects create <name>',
  examples: [
    'locker projects create "Snake"',
    'locker projects create "Snake" && locker upload ./game --project Snake',
  ],
  async run(context, input): Promise<CommandResult> {
    const code = context.requireCode();
    const name = requirePositional(
      input,
      0,
      'a name',
      'locker projects create "My project"',
    ).trim();

    if (name.length === 0 || name.length > MAXIMUM_NAME_LENGTH) {
      throw usageError(`A project name is between 1 and ${MAXIMUM_NAME_LENGTH} characters.`);
    }

    // Names are not unique and the API would take a second "Snake" without
    // complaint, which is precisely the ambiguity `upload` then cannot resolve.
    // Said here, where it is still one keystroke to pick another name.
    const locker = await fetchLocker(context);
    if (findProject(locker, name)) {
      throw usageError(
        `This locker already has a project called "${name}".`,
        `locker upload ./files --project ${JSON.stringify(name)}`,
      );
    }

    if (context.dryRun) {
      return {
        human: `Would make an empty project called "${name}".`,
        data: { dryRun: true, name },
      };
    }

    const project = await context.api.request<ProjectDetails>(
      `/api/lockers/${encodeURIComponent(code)}/projects`,
      {
        method: 'POST',
        // Said outright: the API refuses a project with nothing in it unless the
        // caller asked for one, so that a screen which forgot to attach the
        // files still hears about it.
        body: { name, link: null, ticket: null, allowEmpty: true },
        notFound: { kind: 'credential' },
      },
    );

    context.reporter.success(`Made "${project.name}" — empty for now.`);
    return {
      human: `${shortId(project.id)}  ${project.name}`,
      data: project,
    };
  },
};
