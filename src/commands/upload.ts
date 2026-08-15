import type { ProjectDetails } from '../api/types.js';
import { flagSet, optionalString } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import type { Context } from '../runtime/context.js';
import { notFoundError, usageError } from '../runtime/exit.js';
import { formatBytes, pluralize, shortId } from '../runtime/format.js';
import { buildManifest, type Manifest } from '../domain/manifest.js';
import { fetchLocker, findProject, remainingBytes } from '../domain/locker.js';
import { performUpload } from '../domain/upload.js';
import { renderTable } from '../runtime/style.js';

/**
 * Putting files into a project that exists.
 *
 * One flag says where they go, and it is the same flag every time: `--project`
 * names a project, by name or by id. It used to be two — one to make a project
 * and one to add to it — which meant a child's second upload was typed
 * differently from their first and told them so by failing.
 *
 * Making a project is `projects create`, and this command never does it. That is
 * the whole reason the ambiguity is safe to have collapsed into one flag: a
 * mistyped name here is a refusal naming the command that would fix it, not a
 * second project called "Snak" holding one file. Nothing about where a child's
 * work lands is inferred — not from the folder's name, and not from a name
 * happening to be free.
 */
export const uploadCommand: Command = {
  path: ['upload'],
  summary: 'Put files into a project that already exists',
  description:
    'Say where the files go with --project, by name or id. The project has to be\n' +
    'there already — "locker projects create <name>" makes one.\n' +
    'A folder keeps its shape, so "locker upload ./game --project Snake" arrives\n' +
    'as a game folder.',
  usage: 'locker upload [paths...] --project <project> [--link <url>]',
  options: {
    project: {
      type: 'string',
      description: 'The project the files go into, by name or id. It has to exist.',
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
    // The two spellings this replaced. Still accepted, because they are in a
    // published version, in scripts, and in the README somebody has open. `--to`
    // means what it always meant; `--name` now refuses where it used to make a
    // project, and says which command does that instead.
    name: { type: 'string', hidden: true, description: 'Old name for --project.' },
    to: { type: 'string', hidden: true, description: 'Old name for --project.' },
  },
  examples: [
    'locker projects create "Snake"',
    'locker upload ./my-game --project "Snake" --dry-run',
    'locker upload ./my-game --project "Snake"',
    'locker upload extra-level.py --project Snake',
    'locker upload --link https://scratch.mit.edu/projects/123 --project "Snake"',
  ],
  async run(context, input): Promise<CommandResult> {
    const paths = input.positionals;
    const link = optionalString(input, 'link');
    // The old spellings mean exactly what the new one means, so whichever was
    // typed is the same answer to the same question.
    const wanted = (
      optionalString(input, 'project') ??
      optionalString(input, 'name') ??
      optionalString(input, 'to')
    )?.trim();

    if (!wanted) {
      throw usageError(
        'Say where these files go with --project.',
        'locker upload ./my-project --project "My project"',
      );
    }
    if (paths.length === 0 && !link) {
      throw usageError(
        'Nothing to upload. Give at least one file or folder, or a --link.',
        'locker upload ./my-project --project "My project"',
      );
    }

    const manifest = await buildManifest(paths, { includeAll: flagSet(input, 'all') });
    for (const skipped of manifest.skipped) {
      context.reporter.warn(`Skipped ${skipped}`, { important: true });
    }

    // The locker answers both halves at once: which project was meant, and how
    // much room is left for a dry run to report.
    const locker = await fetchLocker(context);
    const project = findProject(locker, wanted);
    if (!project) {
      // The recovery is the command that fixes it, carrying the name as typed —
      // which is also how a typo announces itself, by quoting back something
      // nobody meant to create.
      throw notFoundError(
        `No project here is called "${wanted}".`,
        `locker projects create ${JSON.stringify(wanted)}`,
      );
    }
    if (context.dryRun) {
      return preview(context, manifest, project, link, remainingBytes(locker), locker.storageLimitBytes);
    }

    const outcome = await performUpload(context, { manifest, project, link });
    const saved = outcome.project;

    context.reporter.success(
      // A pasted link is an upload of no files, and counting them says "0 files"
      // about something that plainly worked.
      outcome.fileCount === 0 && link
        ? `Added a link to "${saved.name}".`
        : `Added ${pluralize(outcome.fileCount, 'file')} to "${saved.name}" (${formatBytes(outcome.totalBytes)}).`,
    );
    // Said out loud: what waits at a Dojo that reviews is everybody else, and a
    // child who is not told will think their share link is broken.
    if (saved.reviewState === 'Pending') {
      context.reporter.note(
        'A mentor still has to look at this before a share link will open for anybody else.',
      );
    }

    return {
      human: [
        `${saved.name}  ${context.palette.dim(shortId(saved.id))}`,
        ...saved.files.map(
          (file) =>
            `  ${file.relativePath ? `${file.relativePath}/` : ''}${file.name}` +
            `  ${context.palette.dim(file.externalUrl ? 'link' : formatBytes(file.size))}`,
        ),
      ].join('\n'),
      data: saved,
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
  project: ProjectDetails,
  link: string | undefined,
  remaining: number,
  limit: number,
): CommandResult {
  const fits = manifest.totalBytes <= remaining;
  const destination =
    `"${project.name}", which already holds ${pluralize(project.files.length, 'file')}`;

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
      // Kept as an object with a kind rather than flattened, so a reader that
      // handled the old two shapes still finds what it was looking for.
      target: { kind: 'existing', id: project.id, name: project.name },
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
