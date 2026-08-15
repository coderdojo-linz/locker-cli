import { flagSet, optionalString } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import type { Context } from '../runtime/context.js';
import { usageError } from '../runtime/exit.js';
import { formatBytes, pluralize, shortId } from '../runtime/format.js';
import { buildManifest, type Manifest } from '../domain/manifest.js';
import { fetchLocker, remainingBytes, resolveProject } from '../domain/locker.js';
import { performUpload, type UploadTarget } from '../domain/upload.js';
import { renderTable } from '../runtime/style.js';

const MAXIMUM_NAME_LENGTH = 120;

/**
 * The command most people run first.
 *
 * Where the files go is always said out loud — `--name` makes a project,
 * `--to` adds to one that exists — and neither is guessed. A default taken from
 * the folder name reads as helpful right up until somebody uploads twice and
 * finds two projects called "src"; and picking "add to it" because a name
 * happens to match would mean a coincidence deciding where a child's work lands.
 */
export const uploadCommand: Command = {
  path: ['upload'],
  summary: 'Put files into a new project, or into one that already exists',
  description:
    'Say where the files go: --name makes a new project, --to adds to one already there.\n' +
    'A folder keeps its shape, so "locker upload ./game --name Snake" arrives as a game folder.',
  usage: 'locker upload [paths...] (--name <name> | --to <project>) [--link <url>]',
  options: {
    name: {
      type: 'string',
      description: 'Make a new project with this name.',
      placeholder: '<name>',
    },
    to: {
      type: 'string',
      description: 'Add to a project that already exists, by name or id.',
      placeholder: '<project>',
    },
    link: {
      type: 'string',
      description: 'A web address to save alongside the files, or instead of them.',
      placeholder: '<url>',
    },
    all: {
      type: 'boolean',
      description: 'Include .git, node_modules and friends, which are skipped by default.',
    },
  },
  examples: [
    'locker upload ./my-game --name "Snake" --dry-run',
    'locker upload ./my-game --name "Snake"',
    'locker upload extra-level.py --to Snake',
    'locker upload --link https://scratch.mit.edu/projects/123 --name "My Scratch project"',
  ],
  async run(context, input): Promise<CommandResult> {
    const paths = input.positionals;
    const link = optionalString(input, 'link');
    const name = optionalString(input, 'name')?.trim();
    const to = optionalString(input, 'to')?.trim();

    if (name && to) {
      throw usageError(
        'Give either --name to make a new project or --to to add to one, not both.',
        'locker upload ./files --to Snake',
      );
    }
    if (!name && !to) {
      throw usageError(
        'Say where these files go: --name for a new project, --to for one that exists.',
        'locker upload ./my-project --name "My project"',
      );
    }
    if (name !== undefined && (name.length === 0 || name.length > MAXIMUM_NAME_LENGTH)) {
      throw usageError(`A project name is between 1 and ${MAXIMUM_NAME_LENGTH} characters.`);
    }
    if (paths.length === 0 && !link) {
      throw usageError(
        'Nothing to upload. Give at least one file or folder, or a --link.',
        'locker upload ./my-project --name "My project"',
      );
    }

    const manifest = await buildManifest(paths, { includeAll: flagSet(input, 'all') });
    for (const skipped of manifest.skipped) {
      context.reporter.warn(`Skipped ${skipped}`, { important: true });
    }

    // Fetched for both shapes: `--to` needs it to resolve the project, and a
    // dry run needs it to say how much room is left.
    const locker = await fetchLocker(context);
    const target: UploadTarget = to
      ? { kind: 'existing', project: resolveProject(locker, to) }
      : { kind: 'new', name: name as string };

    if (context.dryRun) return preview(context, manifest, target, link, remainingBytes(locker), locker.storageLimitBytes);

    const outcome = await performUpload(context, { manifest, target, link });
    const { project } = outcome;

    context.reporter.success(
      outcome.added
        ? `Added ${pluralize(outcome.fileCount, 'file')} to "${project.name}" (${formatBytes(outcome.totalBytes)}).`
        : `Saved "${project.name}" — ${pluralize(outcome.fileCount, 'file')}, ${formatBytes(outcome.totalBytes)}.`,
    );
    // Saved either way: what waits at a Dojo that reviews is everybody else, and
    // a child who is not told will think their share link is broken.
    if (project.reviewState === 'Pending') {
      context.reporter.note(
        'A mentor still has to look at this before a share link will open for anybody else.',
      );
    }

    return {
      human: [
        `${project.name}  ${context.palette.dim(shortId(project.id))}`,
        ...project.files.map(
          (file) =>
            `  ${file.relativePath ? `${file.relativePath}/` : ''}${file.name}` +
            `  ${context.palette.dim(file.externalUrl ? 'link' : formatBytes(file.size))}`,
        ),
      ].join('\n'),
      data: project,
    };
  },
};

/**
 * What would happen, without anything happening.
 *
 * The locker was read to work out where the files were going and how much room
 * is left — a remote read inside a dry run, so it is said in the help rather
 * than being a surprise. Nothing is written and no upload is authorised.
 */
function preview(
  context: Context,
  manifest: Manifest,
  target: UploadTarget,
  link: string | undefined,
  remaining: number,
  limit: number,
): CommandResult {
  const fits = manifest.totalBytes <= remaining;
  const destination =
    target.kind === 'new'
      ? `a new project "${target.name}"`
      : `"${target.project.name}", which already holds ${pluralize(target.project.files.length, 'file')}`;

  const table = renderTable(
    [{ header: 'file', max: 60 }, { header: 'size', align: 'right' }],
    manifest.files.map((file) => [file.name, formatBytes(file.size)]),
    context.palette,
  );

  return {
    human: [
      `Would put ${pluralize(manifest.files.length, 'file')} into ${destination}.`,
      table,
      `${pluralize(manifest.files.length, 'file')} · ${formatBytes(manifest.totalBytes)}`,
      `Room left in the locker: ${formatBytes(remaining)} of ${formatBytes(limit)}`,
      link ? `Link: ${link}` : '',
      fits ? '' : context.palette.yellow('This would not fit. Nothing has been uploaded.'),
      context.palette.dim('Nothing was uploaded. Run again without --dry-run to do it.'),
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
    data: {
      dryRun: true,
      target:
        target.kind === 'new'
          ? { kind: 'new', name: target.name }
          : { kind: 'existing', id: target.project.id, name: target.project.name },
      link: link ?? null,
      files: manifest.files.map((file) => ({
        name: file.name,
        size: file.size,
        contentType: file.contentType,
      })),
      totalBytes: manifest.totalBytes,
      skipped: manifest.skipped,
      remainingBytes: remaining,
      wouldFit: fits,
    },
  };
}
