import fs from 'node:fs/promises';
import type { AuthorizedUpload, ProjectDetails, UploadFileRequest } from '../api/types.js';
import { formatBytes } from '../runtime/format.js';
import type { Context } from '../runtime/context.js';
import type { Manifest, PlannedFile } from './manifest.js';

/**
 * Putting files into a locker.
 *
 * Three calls, in this order, and the CLI hides all of them:
 *
 *   1. ask the API to authorise the list, and get back one URL per file
 *   2. send each file's bytes straight to storage, never through the API
 *   3. tell the API the files have landed, which is when the project exists
 *
 * The reason it is worth hiding is step 2: the bytes go to a bucket, so a 200 MB
 * upload costs the Locker's own server nothing. The reason it is worth getting
 * right is what happens when it breaks — see <see cref="abandon"/>.
 */

/** How many files are sent at once. */
const CONCURRENCY = 4;

/**
 * Where the files are going.
 *
 * Named rather than inferred from whether a project with that name happens to
 * exist. "Make a new project" and "add to that one" are different intentions,
 * and a project name is not unique — so letting a coincidence decide which one
 * happened is how somebody ends up with files in the wrong place.
 */
export type UploadTarget =
  | { kind: 'new'; name: string }
  | { kind: 'existing'; project: ProjectDetails };

export interface UploadRequest {
  manifest: Manifest;
  target: UploadTarget;
  link?: string | undefined;
}

export interface UploadOutcome {
  project: ProjectDetails;
  fileCount: number;
  totalBytes: number;
  /** True when the files joined a project that was already there. */
  added: boolean;
}

export async function performUpload(
  context: Context,
  request: UploadRequest,
): Promise<UploadOutcome> {
  const code = context.requireCode();
  const { manifest, target, link } = request;
  const projectId = target.kind === 'existing' ? target.project.id : undefined;

  const authorization = await authorize(context, code, manifest.files, projectId);
  // From here on a ticket exists and the locker has space held against it, so
  // every exit path has to go through abandon or the locker stays reserved.
  let released = false;
  const releaseOnce = async (): Promise<void> => {
    if (released) return;
    released = true;
    await abandon(context, code, authorization?.ticket);
  };

  const onInterrupt = (): void => {
    // Best effort and deliberately not awaited past the process exiting: giving
    // the space back is worth attempting, but a hanging Ctrl-C is not.
    void releaseOnce().finally(() => process.exit(10));
  };
  process.once('SIGINT', onInterrupt);

  try {
    if (authorization) await sendAll(context, authorization, manifest);

    const ticket = authorization?.ticket ?? null;
    const project =
      target.kind === 'new'
        ? await context.api.request<ProjectDetails>(
            `/api/lockers/${encodeURIComponent(code)}/projects`,
            {
              method: 'POST',
              body: { name: target.name, link: link ?? null, ticket },
              notFound: { kind: 'credential' },
            },
          )
        : await context.api.request<ProjectDetails>(
            `/api/lockers/${encodeURIComponent(code)}/projects/${target.project.id}/files`,
            {
              method: 'POST',
              body: { link: link ?? null, ticket },
              notFound: {
                kind: 'resource',
                message: `"${target.project.name}" is no longer in this locker.`,
                recovery: 'locker projects list',
              },
            },
          );

    released = true; // The ticket was spent by that call; there is nothing to give back.
    return {
      project,
      fileCount: manifest.files.length,
      totalBytes: manifest.totalBytes,
      added: target.kind === 'existing',
    };
  } catch (error) {
    await releaseOnce();
    throw error;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    context.reporter.clearProgress();
  }
}

/**
 * Puts new bytes behind a file that already exists.
 *
 * The same three steps, ending at a different endpoint: the file keeps its id
 * and its name, so a share link pointing at it goes on working. The name of the
 * local file being sent is irrelevant and the API ignores it.
 */
export async function performReplace(
  context: Context,
  projectId: string,
  file: { id: string; name: string },
  replacement: PlannedFile,
): Promise<ProjectDetails> {
  const code = context.requireCode();
  const manifest: Manifest = {
    files: [replacement],
    totalBytes: replacement.size,
    skipped: [],
  };

  const authorization = await authorize(context, code, manifest.files, undefined);
  let released = false;
  const releaseOnce = async (): Promise<void> => {
    if (released) return;
    released = true;
    await abandon(context, code, authorization?.ticket);
  };

  const onInterrupt = (): void => {
    void releaseOnce().finally(() => process.exit(10));
  };
  process.once('SIGINT', onInterrupt);

  try {
    if (authorization) await sendAll(context, authorization, manifest);

    const project = await context.api.request<ProjectDetails>(
      `/api/lockers/${encodeURIComponent(code)}/projects/${projectId}/files/${file.id}/content`,
      {
        method: 'PUT',
        body: { ticket: authorization?.ticket ?? '' },
        notFound: {
          kind: 'resource',
          message: `"${file.name}" is no longer in that project.`,
          recovery: 'locker projects list',
        },
      },
    );

    released = true;
    return project;
  } catch (error) {
    await releaseOnce();
    throw error;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    context.reporter.clearProgress();
  }
}

/** Returns null for a link-only project, which needs no upload at all. */
async function authorize(
  context: Context,
  code: string,
  files: PlannedFile[],
  projectId: string | undefined,
): Promise<AuthorizedUpload | null> {
  if (files.length === 0) return null;

  // The destination is named here, when there is one, so that a folder which
  // would push a project past its file limit is refused before any bytes move.
  const body: { files: UploadFileRequest[]; projectId?: string } = {
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      contentType: file.contentType,
    })),
    ...(projectId ? { projectId } : {}),
  };

  context.reporter.note(
    `Asking for room for ${files.length} file${files.length === 1 ? '' : 's'} (${formatBytes(
      files.reduce((total, file) => total + file.size, 0),
    )})…`,
  );
  return context.api.request<AuthorizedUpload>(
    `/api/lockers/${encodeURIComponent(code)}/projects/uploads`,
    { method: 'POST', body, notFound: { kind: 'credential' } },
  );
}

/**
 * Sends every file, a few at a time, reporting as it goes.
 *
 * Files are matched to targets by the name that was sent: the API echoes the
 * client's own name back for exactly this reason, so neither side has to rely on
 * the two lists staying in the same order.
 */
async function sendAll(
  context: Context,
  authorization: AuthorizedUpload,
  manifest: Manifest,
): Promise<void> {
  const targets = new Map(authorization.files.map((file) => [file.name, file]));
  let done = 0;
  let sentBytes = 0;

  const queue = [...manifest.files];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const file = queue.shift();
      if (!file) return;

      const target = targets.get(file.name);
      if (!target) {
        throw new Error(`The Locker did not offer anywhere to put "${file.name}".`);
      }

      // Read whole rather than streamed. The API caps a single file well below
      // anything worth streaming, and a presigned PUT generally insists on a
      // Content-Length that a stream cannot supply without buffering anyway.
      const bytes = await fs.readFile(file.absolutePath);
      await context.api.putBytes(target.url, bytes, target.headers);

      done += 1;
      sentBytes += file.size;
      context.reporter.progress(
        `  ${done}/${manifest.files.length} · ${formatBytes(sentBytes)} of ${formatBytes(
          manifest.totalBytes,
        )} · ${file.name}`,
      );
    }
  });

  await Promise.all(workers);
  context.reporter.clearProgress();
}

/**
 * Hands the upload back when it will not be finished.
 *
 * The API designed this call to be safe at any point — it answers the same
 * whether the ticket is live, already spent, or unknown — so the CLI can fire it
 * on any failure without first working out how far it got. Skipping it would
 * leave the locker's space reserved until the ticket lapsed, which is how a
 * child ends up unable to retry a failed upload into a locker that is empty.
 */
async function abandon(context: Context, code: string, ticket: string | undefined): Promise<void> {
  if (!ticket) return;
  try {
    await context.api.request(`/api/lockers/${encodeURIComponent(code)}/projects/uploads`, {
      method: 'DELETE',
      body: { ticket },
    });
    context.reporter.debug(1, 'Released the space this upload was holding.');
  } catch (error) {
    // Never allowed to replace the real failure. The hold expires on its own;
    // the original error is what the person needs to read.
    context.diagnostics.record('abandon failed', String(error));
    context.reporter.debug(1, 'Could not release the upload; it will expire on its own.');
  }
}
