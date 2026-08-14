/**
 * The rules the API applies to an uploaded file's name, applied here first.
 *
 * A copy of server logic is normally a liability. This one earns its place twice
 * over. Going out, it means a folder with one bad name in it is reported before
 * a single byte moves, naming the file, instead of arriving as a 400 after a
 * long upload. Coming back, the same rules decide where a downloaded file may be
 * written — and there the check is not a convenience but the thing standing
 * between a hostile name and a file written outside the chosen directory.
 *
 * Kept deliberately in step with UploadPath.cs in the API. If the two ever
 * disagree the server still wins, because it validates again on arrival; the
 * cost of drift is a confusing message, not a hole.
 */

export const MAXIMUM_DEPTH = 16;
export const MAXIMUM_PATH_LENGTH = 400;
export const MAXIMUM_NAME_LENGTH = 255;

/** Reserved on Windows whatever the extension, so refused everywhere for portability. */
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

// ':' and '|' are path-significant on Windows and in URLs; the rest are the
// usual cross-platform offenders.
const INVALID_CHARACTERS = /[<>:"|?*]/;

export interface ParsedUploadPath {
  name: string;
  relativePath: string | null;
  error: string | null;
}

const invalid = (error: string): ParsedUploadPath => ({ name: '', relativePath: null, error });

/**
 * Splits "site/img/logo.png" into a folder and a name, or explains why it cannot.
 *
 * Backslashes become forward slashes first, so a path built on Windows is judged
 * by the same rules as one built anywhere else.
 */
export function parseUploadPath(raw: string): ParsedUploadPath {
  const value = raw.replaceAll('\\', '/').trim();
  if (value.length === 0) return invalid('A file in this upload has no name.');
  if (value.length > MAXIMUM_PATH_LENGTH) {
    return invalid(`Folder paths must be ${MAXIMUM_PATH_LENGTH} characters or fewer.`);
  }
  // A leading slash or a drive letter is an absolute location, never a path
  // inside the folder that was chosen.
  if (value.startsWith('/') || (value.length > 1 && value[1] === ':')) {
    return invalid('File paths must be relative to the folder you chose.');
  }

  const segments = value.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return invalid('A file in this upload has no name.');
  if (segments.length - 1 > MAXIMUM_DEPTH) {
    return invalid(`Folders may be nested at most ${MAXIMUM_DEPTH} levels deep.`);
  }

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      return invalid('File paths may not navigate outside the folder you chose.');
    }
    if (segment.length > MAXIMUM_NAME_LENGTH) {
      return invalid(`File and folder names must be ${MAXIMUM_NAME_LENGTH} characters or fewer.`);
    }
    if (segment.endsWith(' ') || segment.endsWith('.')) {
      return invalid('File and folder names may not end with a space or a dot.');
    }
    if (INVALID_CHARACTERS.test(segment) || hasControlCharacter(segment)) {
      return invalid('File and folder names contain a character that is not allowed.');
    }
    if (RESERVED_NAMES.has((segment.split('.')[0] ?? '').toUpperCase())) {
      return invalid(`"${segment}" is a reserved name on some systems.`);
    }
  }

  const name = segments[segments.length - 1] as string;
  return {
    name,
    relativePath: segments.length > 1 ? segments.slice(0, -1).join('/') : null,
    error: null,
  };
}

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point < 32 || point === 127;
  });

/**
 * The path a downloaded file may be written to, relative to the output
 * directory — or null when the server sent something that must not be trusted.
 *
 * File names in a locker were supplied by whoever uploaded them. The API checks
 * them on the way in, but a client that writes wherever it is told is one
 * database edit or one older server away from writing outside the folder the
 * person picked. So the answer is recomputed here rather than assumed.
 */
export function safeRelativeTarget(
  relativePath: string | null,
  name: string,
): { segments: string[] } | null {
  const combined = relativePath ? `${relativePath}/${name}` : name;
  const parsed = parseUploadPath(combined);
  if (parsed.error) return null;

  const segments = [...(parsed.relativePath ? parsed.relativePath.split('/') : []), parsed.name];
  // Belt and braces over parseUploadPath, which already refuses these: this is
  // the check that actually keeps a write inside the chosen directory, and it
  // should not depend on another function staying correct.
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.length === 0)) {
    return null;
  }
  return { segments };
}
