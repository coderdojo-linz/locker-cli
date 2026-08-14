import { CliError, Exit, type ErrorKind, type ExitCode } from './exit.js';

/**
 * What an HTTP status from the Locker actually means.
 *
 * Kept apart from the client that makes the requests because this is the part
 * worth reading on its own: the mapping is not obvious, and getting it wrong is
 * the difference between a kid being told "check the code on your card" and
 * being told "not found".
 *
 * The API has no authorization on the endpoints a child uses — the code in the
 * path is the whole credential — so a wrong code produces a 404 from the locker
 * lookup, never a 401.
 */

/** What a 404 means, which depends entirely on what was being asked for. */
export type NotFoundMeaning =
  | { kind: 'credential' }
  | { kind: 'resource'; message: string; recovery?: string };

export function explainStatus(
  status: number,
  body: string,
  notFound?: NotFoundMeaning,
): CliError {
  const problem = parseProblem(body);
  const build = (
    message: string,
    kind: ErrorKind,
    exitCode: ExitCode,
    recovery?: string,
  ): CliError => new CliError(message, { kind, exitCode, recovery, detail: body });

  switch (status) {
    case 400:
      return build(problem ?? 'The Locker refused that as invalid.', 'validation', Exit.Usage);
    case 401:
      return build(
        problem ?? 'That locker code was not accepted.',
        'not-authenticated',
        Exit.NotAuthenticated,
        'locker auth login',
      );
    case 403:
      return build(problem ?? 'That is not allowed.', 'not-authorized', Exit.NotAuthorized);
    case 404:
      // The only genuinely ambiguous status the API returns, which is why the
      // caller has to say what it was looking for.
      if (!notFound || notFound.kind === 'credential') {
        return build(
          "That code doesn't open a locker. Check the code on your card.",
          'not-authenticated',
          Exit.NotAuthenticated,
          'locker auth login',
        );
      }
      return build(notFound.message, 'not-found', Exit.NotFound, notFound.recovery);
    case 409:
      return build(problem ?? 'That had already been done.', 'conflict', Exit.Conflict);
    case 413:
      return build(
        problem ?? 'That would not fit in the locker.',
        'quota-exceeded',
        Exit.Throttled,
        'locker status   (to see how much room is left)',
      );
    case 429:
      return build(
        problem ?? 'The Locker is busy with this locker right now. Try again shortly.',
        'rate-limited',
        Exit.Throttled,
      );
    default:
      if (status >= 500) {
        return build(
          `The Locker had a problem of its own (HTTP ${status}). This is server-side; nothing here will fix it.`,
          'server',
          Exit.Failure,
        );
      }
      return build(problem ?? `The Locker answered HTTP ${status}.`, 'failure', Exit.Failure);
  }
}

/**
 * Pulls the sentence out of whatever shape the failure arrived in.
 *
 * The API words these for children and translates them, so they are shown as
 * written rather than replaced with wording of the CLI's own.
 */
function parseProblem(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return null;
    const problem = parsed as {
      errors?: Record<string, string[]>;
      detail?: string;
      title?: string;
      message?: string;
    };

    if (problem.errors) {
      const messages = Object.values(problem.errors).flat().filter(Boolean);
      if (messages.length > 0) return messages.join(' ');
    }
    return problem.detail ?? problem.message ?? problem.title ?? null;
  } catch {
    return null;
  }
}

/** DNS, TLS, refused, and timeouts all mean the same thing: the server was never reached. */
export function transportError(url: string, cause: unknown): CliError {
  const host = safeHost(url);
  const timedOut =
    cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
  return new CliError(
    timedOut ? `${host} did not answer in time.` : `Could not reach ${host}.`,
    {
      kind: 'transport',
      exitCode: Exit.Transport,
      recovery: `Check your connection, then: locker status --host ${host}`,
      cause,
    },
  );
}

const safeHost = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};
