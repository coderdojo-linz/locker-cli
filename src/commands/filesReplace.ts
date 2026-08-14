import { requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { formatBytes, shortId } from '../runtime/format.js';
import { buildManifest } from '../domain/manifest.js';
import { fetchLocker, fullName, resolveFile, resolveProject } from '../domain/locker.js';
import { performReplace } from '../domain/upload.js';
import { usageError } from '../runtime/exit.js';
import { confirm } from '../runtime/prompt.js';

/**
 * Puts new bytes behind a file that is already in a project.
 *
 * Destructive, because what was there before is gone and there is no copy: the
 * API deletes the old bytes once the row points at the new ones. The file's id
 * and name survive, which is the whole point — links to it keep working, and a
 * project's shape does not change because one file was edited.
 */
export const filesReplaceCommand: Command = {
  path: ['files', 'replace'],
  summary: 'Put new contents behind a file that is already there',
  description:
    'The file keeps its name and its id, so any link to it goes on working.\n' +
    'What was there before is replaced and cannot be recovered.',
  usage: 'locker files replace <project> <file> <path> [--yes]',
  destructive: true,
  examples: [
    'locker files replace Snake main.py ./main.py --dry-run',
    'locker files replace Snake main.py ./main.py',
  ],
  async run(context, input): Promise<CommandResult> {
    const code = context.requireCode();
    const projectReference = requirePositional(input, 0, 'a project', 'locker projects list');
    const fileReference = requirePositional(
      input,
      1,
      'a file to replace',
      `locker files list ${projectReference}`,
    );
    const path = requirePositional(
      input,
      2,
      'a local file to put in its place',
      `locker files replace ${projectReference} ${fileReference} ./new-version`,
    );

    const manifest = await buildManifest([path]);
    const replacement = manifest.files[0];
    if (!replacement || manifest.files.length !== 1) {
      throw usageError(
        'Give exactly one file to replace it with, not a folder.',
        `locker files replace ${projectReference} ${fileReference} ./one-file`,
      );
    }

    const locker = await fetchLocker(context);
    const project = resolveProject(locker, projectReference);
    const file = resolveFile(project, fileReference);
    const was = fullName(file);

    if (file.externalUrl) {
      throw usageError(
        `"${was}" is a link, so it has no contents to replace.`,
        `locker files list ${shortId(project.id)}`,
      );
    }

    const describe = `"${was}" (${formatBytes(file.size)}) with ${replacement.name} (${formatBytes(replacement.size)})`;
    if (context.dryRun) {
      return {
        human: [
          `Would replace ${describe}.`,
          context.palette.dim('Nothing was changed. Run again without --dry-run to do it.'),
        ].join('\n'),
        data: {
          dryRun: true,
          projectId: project.id,
          fileId: file.id,
          name: was,
          fromBytes: file.size,
          toBytes: replacement.size,
        },
      };
    }

    await confirm(
      `Replace ${describe}`,
      { reporter: context.reporter, assumeYes: context.assumeYes },
      `locker files replace ${shortId(project.id)} ${shortId(file.id)} ${path}`,
    );

    const updated = await performReplace(context, project.id, { id: file.id, name: was }, replacement);
    const now = updated.files.find((item) => item.id === file.id);

    context.reporter.success(`Replaced "${was}" — now ${formatBytes(now?.size ?? replacement.size)}.`);
    return { human: `${shortId(file.id)}  ${was}`, data: updated };
  },
};
