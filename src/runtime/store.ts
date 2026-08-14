import fs from 'node:fs';
import path from 'node:path';

/**
 * Reading and writing the CLI's own small JSON files.
 *
 * Both stores want the same three things — survive a file that is not there,
 * survive a file somebody has edited into nonsense, and never leave a truncated
 * file behind — so they share one implementation rather than each growing their
 * own half of it.
 */

/**
 * A missing file and an unreadable one both read as "nothing saved yet".
 *
 * Deliberately quiet. The alternative is refusing to run at all because a stray
 * character got into a config file, which turns a cosmetic problem into a kid
 * who cannot open their locker. What is lost is a setting they can set again;
 * `config path` says where to look if they want to.
 */
export function readJsonFile<T extends object>(file: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

/**
 * Written to a neighbouring file and moved into place, so a process that dies
 * part way through leaves the previous contents rather than half of the new
 * ones.
 *
 * The mode is set at creation rather than by a later chmod: between the two
 * there would be a moment when a credentials file is world-readable. On Windows
 * the mode is ignored by the platform and the file inherits the directory's
 * ACL — which for %APPDATA% is already the user alone.
 */
export function writeJsonFile(file: string, value: object, mode = 0o600): void {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode, encoding: 'utf8' });
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // The rename is what mattered; a leftover temporary file is not worth
      // replacing the real error with one about tidying up after it.
    }
    throw error;
  }
}

export function removeJsonFile(file: string): void {
  fs.rmSync(file, { force: true });
}
