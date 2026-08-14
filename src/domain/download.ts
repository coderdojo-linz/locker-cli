import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectDetails, ProjectFileDetails } from '../api/types.js';
import { CliError, Exit } from '../runtime/exit.js';
import { formatBytes } from '../runtime/format.js';
import type { Context } from '../runtime/context.js';
import { safeRelativeTarget } from './uploadPath.js';

/**
 * Getting a project back out onto a disk.
 *
 * Files are fetched one at a time and written into the folder shape they were
 * uploaded with, rather than pulling the whole-project zip the API can also
 * produce. Two reasons: a folder is what a child actually wants back, and
 * unpacking a zip would need a dependency this CLI does not have. The zip is
 * still available behind `--archive` for anyone who wants one artefact.
 */

export interface DownloadOptions {
  /** Directory the project folder is created inside. */
  outputDirectory: string;
  /** Replace files that are already there instead of leaving them alone. */
  force?: boolean;
  /** Limit the download to one file. */
  onlyFileId?: string | undefined;
}

export interface DownloadedFile {
  name: string;
  path: string;
  size: number;
}

export interface DownloadOutcome {
  directory: string;
  written: DownloadedFile[];
  skipped: string[];
  totalBytes: number;
}

export async function downloadProject(
  context: Context,
  project: ProjectDetails,
  options: DownloadOptions,
): Promise<DownloadOutcome> {
  const code = context.requireCode();
  const directory = path.resolve(options.outputDirectory, safeDirectoryName(project.name));

  const wanted = options.onlyFileId
    ? project.files.filter((file) => file.id === options.onlyFileId)
    : project.files;

  const written: DownloadedFile[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;
  let done = 0;

  for (const file of wanted) {
    // A pasted link is a row with no bytes behind it. Saying so beats writing a
    // stub file nobody asked for.
    if (file.externalUrl) {
      skipped.push(`${file.name} is a link: ${file.externalUrl}`);
      continue;
    }

    const target = resolveTarget(directory, file);
    if (!options.force && (await exists(target))) {
      skipped.push(`${file.name} is already there`);
      continue;
    }

    done += 1;
    context.reporter.progress(`  ${done}/${wanted.length} · ${file.name}`);

    const response = await context.api.requestRaw(
      `/api/lockers/${encodeURIComponent(code)}/projects/${project.id}/files/${file.id}`,
      {
        accept: '*/*',
        notFound: {
          kind: 'resource',
          message: `"${file.name}" is no longer in that project.`,
          recovery: `locker projects show ${project.id}`,
        },
      },
    );

    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);

    written.push({ name: file.name, path: target, size: bytes.byteLength });
    totalBytes += bytes.byteLength;
  }

  context.reporter.clearProgress();
  return { directory, written, skipped, totalBytes };
}

/** The whole project as one zip, which is the only thing the API streams itself. */
export async function downloadArchive(
  context: Context,
  project: ProjectDetails,
  options: DownloadOptions,
): Promise<DownloadOutcome> {
  const code = context.requireCode();
  const directory = path.resolve(options.outputDirectory);
  const target = path.join(directory, `${safeDirectoryName(project.name)}.zip`);

  if (!options.force && (await exists(target))) {
    throw new CliError(`"${target}" is already there.`, {
      kind: 'conflict',
      exitCode: Exit.Conflict,
      recovery: `locker download ${project.id} --archive --force`,
    });
  }

  context.reporter.note(`Fetching ${project.name} as an archive…`);
  const response = await context.api.requestRaw(
    `/api/lockers/${encodeURIComponent(code)}/projects/${project.id}/download`,
    {
      accept: '*/*',
      notFound: {
        kind: 'resource',
        message: `That project has nothing stored to download.`,
        recovery: `locker projects show ${project.id}`,
      },
    },
  );

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(target, bytes);

  return {
    directory,
    written: [{ name: path.basename(target), path: target, size: bytes.byteLength }],
    skipped: [],
    totalBytes: bytes.byteLength,
  };
}

/**
 * Where one file is allowed to be written.
 *
 * The name and folder come from the server, and originally from whoever uploaded
 * them. They are re-checked here rather than trusted: a name like `../../id_rsa`
 * has to become a refusal, not a write. Anything that does not survive the check
 * is flattened to its own last segment, so the file still arrives — under a dull
 * name, inside the chosen directory.
 */
function resolveTarget(directory: string, file: ProjectFileDetails): string {
  const safe = safeRelativeTarget(file.relativePath, file.name);
  const segments = safe?.segments ?? [safeDirectoryName(path.basename(file.name))];
  const target = path.resolve(directory, ...segments);

  // The last word on it. Whatever the segments were, the result must still be
  // inside the directory that was chosen.
  const boundary = directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`;
  if (target !== directory && !target.startsWith(boundary)) {
    throw new CliError(`"${file.name}" would be written outside the download folder.`, {
      kind: 'validation',
      exitCode: Exit.Failure,
    });
  }
  return target;
}

/**
 * A project name reduced to something every file system will accept.
 *
 * Names are up to 120 characters of whatever a child typed, so this has to cope
 * with slashes, colons, trailing dots and the Windows reserved words, and still
 * produce something recognisable.
 */
export function safeDirectoryName(name: string): string {
  const cleaned = Array.from(name.trim())
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      if (point < 32 || point === 127) return '-';
      return /[<>:"|?*/\\]/.test(character) ? '-' : character;
    })
    .join('')
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();

  if (cleaned.length === 0) return 'project';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(cleaned)) return `${cleaned}-project`;
  return cleaned;
}

const exists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

export const describeOutcome = (outcome: DownloadOutcome): string =>
  `${outcome.written.length} file${outcome.written.length === 1 ? '' : 's'} · ${formatBytes(
    outcome.totalBytes,
  )}`;
