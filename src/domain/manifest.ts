import fs from 'node:fs/promises';
import path from 'node:path';
import { contentTypeFor } from './contentType.js';
import { parseUploadPath } from './uploadPath.js';
import { CliError, Exit, usageError } from '../runtime/exit.js';

/** One local file, and the name it will travel under. */
export interface PlannedFile {
  absolutePath: string;
  /** Relative, forward slashes, the folder shape preserved. What the API is told. */
  name: string;
  size: number;
  contentType: string;
}

export interface Manifest {
  files: PlannedFile[];
  totalBytes: number;
  /** Things deliberately left out, so the caller can say so rather than silently dropping them. */
  skipped: string[];
}

/**
 * Directories that are never what somebody meant to upload.
 *
 * A locker holds a couple of hundred megabytes and a single `node_modules` can
 * exceed that on its own, so the common accident is worth refusing by default.
 * Everything skipped is reported, and `--all` turns the list off — a skip nobody
 * is told about is worse than the accident it prevents.
 */
const NOISE = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db', '.svn', '__pycache__']);

export interface ManifestOptions {
  /** Include the noise directories after all. */
  includeAll?: boolean;
}

/**
 * Turns the paths given on the command line into the list the API is asked to
 * authorise.
 *
 * A directory keeps its own name at the front, the way `zip -r` does, so
 * `locker upload ./game` produces `game/sprite.png` and the folder is still
 * there when the project is downloaded again.
 */
export async function buildManifest(
  inputs: string[],
  options: ManifestOptions = {},
): Promise<Manifest> {
  if (inputs.length === 0) return { files: [], totalBytes: 0, skipped: [] };

  const files: PlannedFile[] = [];
  const skipped: string[] = [];

  for (const input of inputs) {
    const absolute = path.resolve(input);
    let stats: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stats = await fs.lstat(absolute);
    } catch {
      throw usageError(`There is nothing at "${input}".`, 'locker upload ./my-project --project "My project"');
    }

    if (stats.isSymbolicLink()) {
      // Not followed: a link can point outside the folder that was chosen, or at
      // its own parent. Neither is something to discover halfway through an
      // upload.
      skipped.push(`${input} (a shortcut)`);
      continue;
    }
    if (stats.isDirectory()) {
      await walk(absolute, path.basename(absolute), files, skipped, options);
      continue;
    }
    if (!stats.isFile()) {
      skipped.push(`${input} (not a file)`);
      continue;
    }
    files.push(plan(absolute, path.basename(absolute), stats.size));
  }

  // Sorted so the same folder always produces the same manifest, which makes a
  // --dry-run worth comparing against the run that follows it.
  files.sort((left, right) => left.name.localeCompare(right.name));
  validate(files);

  return {
    files,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    skipped,
  };
}

async function walk(
  directory: string,
  prefix: string,
  files: PlannedFile[],
  skipped: string[],
  options: ManifestOptions,
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    // Forward slashes, never path.join: this is a name for the API, not a path
    // for this file system, and on Windows path.join would produce backslashes.
    const name = `${prefix}/${entry.name}`;

    if (!options.includeAll && NOISE.has(entry.name)) {
      skipped.push(name);
      continue;
    }
    if (entry.isSymbolicLink()) {
      skipped.push(`${name} (a shortcut)`);
      continue;
    }
    if (entry.isDirectory()) {
      await walk(absolute, name, files, skipped, options);
      continue;
    }
    if (!entry.isFile()) {
      skipped.push(`${name} (not a file)`);
      continue;
    }

    const stats = await fs.stat(absolute);
    files.push(plan(absolute, name, stats.size));
  }
}

const plan = (absolutePath: string, name: string, size: number): PlannedFile => ({
  absolutePath,
  name,
  size,
  contentType: contentTypeFor(name),
});

/**
 * The checks the API would make, made here so they name the offending file.
 *
 * Empty is refused rather than sent: an upload of nothing produces a validation
 * problem about choosing a file, which is a confusing thing to be told after
 * pointing at a folder that turned out to hold only skipped entries.
 */
function validate(files: PlannedFile[]): void {
  if (files.length === 0) {
    throw usageError(
      'None of those paths held a file to upload.',
      'locker upload ./my-project --project "My project" --all',
    );
  }

  const seen = new Set<string>();
  for (const file of files) {
    const parsed = parseUploadPath(file.name);
    if (parsed.error) {
      throw new CliError(`"${file.name}" cannot be uploaded: ${parsed.error}`, {
        kind: 'validation',
        exitCode: Exit.Usage,
      });
    }

    const key = file.name.toLowerCase();
    if (seen.has(key)) {
      throw new CliError(`This upload contains "${file.name}" more than once.`, {
        kind: 'validation',
        exitCode: Exit.Usage,
      });
    }
    seen.add(key);
  }
}
