import path from 'node:path';
import { flagSet, optionalString, requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { formatBytes, pluralize } from '../runtime/format.js';
import { fetchLocker, resolveFile, resolveProject } from '../domain/locker.js';
import { downloadArchive, downloadProject } from '../domain/download.js';

/**
 * Getting work back onto a disk.
 *
 * Bytes are written to files, never to stdout, so `--json` stays meaningful:
 * in JSON mode this reports what was written and where, and the files still go
 * to the folder. That is the pattern for a command whose real output is bytes —
 * metadata on stdout, content on the file system.
 */
export const downloadCommand: Command = {
  path: ['download'],
  summary: 'Save a project to a folder',
  description:
    'Writes the project into a folder here, keeping the shape it was uploaded with.\n' +
    'Files that are already there are left alone unless --force is given.',
  usage: 'locker download <project> [--out <dir>] [--file <file>] [--archive]',
  options: {
    out: {
      type: 'string',
      description: 'Where to put it. Defaults to the current folder.',
      placeholder: '<dir>',
    },
    file: {
      type: 'string',
      description: 'Just one file, by name or id.',
      placeholder: '<file>',
    },
    archive: { type: 'boolean', description: 'Save one .zip instead of a folder of files.' },
    force: { type: 'boolean', description: 'Overwrite files that are already there.' },
  },
  examples: [
    'locker download Snake',
    'locker download Snake --out ~/projects',
    'locker download Snake --file sprite.png',
    'locker download Snake --archive',
  ],
  async run(context, input): Promise<CommandResult> {
    const reference = requirePositional(
      input,
      0,
      'a project to download',
      'locker projects list',
    );

    const locker = await fetchLocker(context);
    const project = resolveProject(locker, reference);
    const outputDirectory = optionalString(input, 'out') ?? process.cwd();
    const force = flagSet(input, 'force');

    const fileReference = optionalString(input, 'file');
    const onlyFileId = fileReference ? resolveFile(project, fileReference).id : undefined;

    if (context.dryRun) {
      const wanted = onlyFileId
        ? project.files.filter((file) => file.id === onlyFileId)
        : project.files;
      return {
        human: [
          `Would save ${pluralize(wanted.length, 'file')} from "${project.name}" into`,
          `  ${path.resolve(outputDirectory)}`,
          context.palette.dim('Nothing was written. Run again without --dry-run to do it.'),
        ].join('\n'),
        data: {
          dryRun: true,
          project: { id: project.id, name: project.name },
          outputDirectory: path.resolve(outputDirectory),
          files: wanted.map((file) => ({ id: file.id, name: file.name, size: file.size })),
        },
      };
    }

    const outcome = flagSet(input, 'archive')
      ? await downloadArchive(context, project, { outputDirectory, force })
      : await downloadProject(context, project, { outputDirectory, force, onlyFileId });

    for (const skipped of outcome.skipped) {
      context.reporter.warn(skipped, { important: true });
    }
    context.reporter.success(
      `Saved ${pluralize(outcome.written.length, 'file')} · ${formatBytes(outcome.totalBytes)}`,
    );

    return {
      human: outcome.written.map((file) => file.path).join('\n'),
      data: {
        project: { id: project.id, name: project.name },
        directory: outcome.directory,
        written: outcome.written,
        skipped: outcome.skipped,
        totalBytes: outcome.totalBytes,
      },
    };
  },
};
