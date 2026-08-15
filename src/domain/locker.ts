import type { LockerDetails, ProjectDetails, ProjectFileDetails } from '../api/types.js';
import { CliError, Exit, notFoundError } from '../runtime/exit.js';
import { shortId } from '../runtime/format.js';
import type { Context } from '../runtime/context.js';

/**
 * Reading a locker, and working out which project somebody meant.
 *
 * One call answers everything: the API returns the locker with every project and
 * every file inside it, so a name can be resolved without a search endpoint and
 * without guessing.
 */

export async function fetchLocker(context: Context): Promise<LockerDetails> {
  const code = context.requireCode();
  return context.api.request<LockerDetails>(`/api/lockers/${encodeURIComponent(code)}`, {
    // A 404 here is always the code: this is the lookup that turns a code into a
    // locker, so there is nothing else it could have failed to find.
    notFound: { kind: 'credential' },
  });
}

/**
 * Looks for the project a reference names, and says so when there is none.
 *
 * Accepts a full id, the short form shown in listings, or a name. Names are not
 * unique within a locker — nothing stops a child calling two projects "Game" —
 * so two matches is an error listing both rather than a silent pick of the
 * first. Guessing there would put files in the wrong place.
 *
 * Finding nothing is not an error here; it is the answer. `upload` treats it as
 * "then make it", and everything else refuses through `resolveProject` below.
 */
export function findProject(
  locker: LockerDetails,
  reference: string,
): ProjectDetails | undefined {
  const wanted = reference.trim();
  if (wanted.length === 0) return undefined;

  const byId = locker.projects.find((project) => project.id === wanted);
  if (byId) return byId;

  const matches = locker.projects.filter(
    (project) =>
      project.name.toLowerCase() === wanted.toLowerCase() ||
      shortId(project.id) === wanted.toLowerCase() ||
      project.id.startsWith(wanted.toLowerCase()),
  );

  if (matches.length <= 1) return matches[0];

  throw new CliError(
    `"${reference}" matches ${matches.length} projects. Use the id instead:\n` +
      matches.map((project) => `  ${shortId(project.id)}  ${project.name}`).join('\n'),
    { kind: 'validation', exitCode: Exit.Usage, recovery: 'locker projects list' },
  );
}

/** The same lookup, for the commands that need a project that already exists. */
export function resolveProject(locker: LockerDetails, reference: string): ProjectDetails {
  if (reference.trim().length === 0) {
    throw notFoundError('No project was named.', 'locker projects list');
  }
  const found = findProject(locker, reference);
  if (found) return found;
  throw notFoundError(`No project here is called "${reference}".`, 'locker projects list');
}

/** The same rules, one level down. A file name is not unique inside a project either. */
export function resolveFile(project: ProjectDetails, reference: string): ProjectFileDetails {
  const wanted = reference.trim();
  const byId = project.files.find((file) => file.id === wanted);
  if (byId) return byId;

  const matches = project.files.filter(
    (file) =>
      file.name.toLowerCase() === wanted.toLowerCase() ||
      fullName(file).toLowerCase() === wanted.toLowerCase() ||
      file.id.startsWith(wanted.toLowerCase()),
  );

  if (matches.length === 1) return matches[0] as ProjectFileDetails;
  if (matches.length === 0) {
    throw notFoundError(
      `"${reference}" is not a file in "${project.name}".`,
      `locker files list ${shortId(project.id)}`,
    );
  }

  throw new CliError(
    `"${reference}" matches ${matches.length} files. Use the id instead:\n` +
      matches.map((file) => `  ${shortId(file.id)}  ${fullName(file)}`).join('\n'),
    { kind: 'validation', exitCode: Exit.Usage, recovery: `locker files list ${shortId(project.id)}` },
  );
}

/** The path as it was uploaded, which is how a person recognises a file in a folder. */
export const fullName = (file: ProjectFileDetails): string =>
  file.relativePath ? `${file.relativePath}/${file.name}` : file.name;

/** How much more will fit, which is the number worth showing before an upload. */
export const remainingBytes = (locker: LockerDetails): number =>
  Math.max(0, locker.storageLimitBytes - locker.usedBytes);
