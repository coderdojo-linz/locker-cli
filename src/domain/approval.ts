import type { ApprovalTicket, UploadGateProblem, UploadPermitDetails } from '../api/types.js';
import type { Context } from '../runtime/context.js';
import { CliError, Exit } from '../runtime/exit.js';

/**
 * Getting past a Dojo that asks for something before an upload.
 *
 * Some Dojos want a mentor to have looked at what a child is saving, or want the
 * child to be in the room. The API says so before any bytes move, and says which
 * of those it wants — so this is where the CLI turns "no" into "here is what to
 * do, I will wait".
 *
 * Waiting is the whole point. A terminal that printed "ask a mentor" and exited
 * would leave a child to run the same command again at exactly the right moment,
 * which is the one thing a nine-year-old with a half-uploaded game will not do.
 */

/** How often the CLI asks whether anything has happened yet. */
const POLL_INTERVAL_MS = 3_000;

/** A stop, in case a server never moves the request off pending. */
const MAXIMUM_WAIT_MS = 25 * 60_000;

/**
 * Reads the gate off a refusal, or null when the refusal was something else.
 *
 * The body is carried on the error rather than parsed at the client, because
 * only this knows the shape is worth looking for.
 */
export function readGate(error: unknown): UploadGateProblem | null {
  if (!(error instanceof CliError) || typeof error.detail !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(error.detail);
    if (!parsed || typeof parsed !== 'object') return null;
    const gate = (parsed as { uploadGate?: unknown }).uploadGate;
    if (!gate || typeof gate !== 'object') return null;
    const verdict = (gate as { verdict?: unknown }).verdict;
    return typeof verdict === 'string' ? (gate as UploadGateProblem) : null;
  } catch {
    return null;
  }
}

export interface ApprovalRequest {
  projectName: string | undefined;
  fileCount: number;
  totalBytes: number;
}

/**
 * Does whatever this Dojo's rule needs, and comes back when the way is clear.
 *
 * Throws when there is nothing the CLI can do — a network rule cannot be
 * satisfied by waiting, and a mentor who says no has said no.
 */
export async function clearGate(
  context: Context,
  code: string,
  gate: UploadGateProblem,
  request: ApprovalRequest,
): Promise<void> {
  if (gate.verdict === 'NeedsApproval') return waitForMentor(context, code, request);
  if (gate.verdict === 'NeedsEventCode') return waitForEventCode(context, code, gate);
  throw wrongPlace(gate);
}

/**
 * Opens a request, draws its QR code, and waits for a mentor to answer.
 *
 * The QR code goes to stderr with everything else the CLI says about itself:
 * stdout carries the answer, and a picture made of block characters is not it.
 */
async function waitForMentor(
  context: Context,
  code: string,
  request: ApprovalRequest,
): Promise<void> {
  const path = `/api/lockers/${encodeURIComponent(code)}/upload-approvals`;
  const ticket = await context.api.request<ApprovalTicket>(path, {
    method: 'POST',
    body: {
      projectName: request.projectName ?? null,
      fileCount: request.fileCount,
      totalBytes: request.totalBytes,
    },
    notFound: { kind: 'credential' },
  });

  // A script cannot hold a phone up to anything, so it is told where the request
  // is and left to decide, rather than being hung for twenty minutes.
  if (context.reporter.isJson) throw unattended(ticket);

  context.reporter.note('');
  context.reporter.note('A mentor has to approve this upload.');
  context.reporter.note('Show them this, or send them the link:');
  context.reporter.note('');
  context.reporter.note(await drawQrCode(context, code, ticket.code));
  context.reporter.note(context.palette.cyan(ticket.approveUrl));
  context.reporter.note('');

  const deadline = Date.now() + MAXIMUM_WAIT_MS;
  for (let waited = 0; Date.now() < deadline; waited += POLL_INTERVAL_MS) {
    context.reporter.progress(`  waiting for a mentor… ${Math.round(waited / 1000)}s`);
    await delay(POLL_INTERVAL_MS);
    const current = await context.api.request<ApprovalTicket>(
      `${path}/${encodeURIComponent(ticket.code)}`,
      { notFound: { kind: 'credential' } },
    );
    if (current.status === 'Approved') {
      context.reporter.clearProgress();
      context.reporter.success(
        current.decidedByName
          ? `${current.decidedByName} approved it. Uploading…`
          : 'Approved. Uploading…',
      );
      return;
    }
    if (current.status === 'Denied') {
      context.reporter.clearProgress();
      throw new CliError('A mentor did not approve this upload.', {
        kind: 'not-authorized',
        exitCode: Exit.NotAuthorized,
        recovery: 'Ask them what to change, then run the command again.',
      });
    }
    if (current.status === 'Expired') {
      context.reporter.clearProgress();
      throw new CliError('Nobody answered, and the request has run out.', {
        kind: 'not-authorized',
        exitCode: Exit.NotAuthorized,
        recovery: 'locker upload …   (to ask again)',
      });
    }
  }

  context.reporter.clearProgress();
  throw new CliError('Gave up waiting for a mentor to approve this upload.', {
    kind: 'not-authorized',
    exitCode: Exit.NotAuthorized,
    recovery: 'locker upload …   (to ask again)',
  });
}

/**
 * Waits for the child to scan the code hanging in the room.
 *
 * There is nothing for the CLI to scan with, so it says what to do and then
 * watches the locker: the phone that scans claims on behalf of the locker code,
 * not of any particular screen, so the permission simply appears here.
 */
async function waitForEventCode(
  context: Context,
  code: string,
  gate: UploadGateProblem,
): Promise<void> {
  if (context.reporter.isJson) {
    throw new CliError('Scan the QR code in the room before uploading.', {
      kind: 'not-authorized',
      exitCode: Exit.NotAuthorized,
      recovery: 'Scan the code on the wall with a phone, then run this again.',
    });
  }

  const where = gate.eventName ? ` at ${gate.eventName}` : '';
  context.reporter.note('');
  context.reporter.note(`Scan the QR code hanging up in the room${where} with your phone,`);
  context.reporter.note('open your locker there, and this will carry on by itself.');
  context.reporter.note('');

  const deadline = Date.now() + MAXIMUM_WAIT_MS;
  for (let waited = 0; Date.now() < deadline; waited += POLL_INTERVAL_MS) {
    context.reporter.progress(`  waiting for the code to be scanned… ${Math.round(waited / 1000)}s`);
    await delay(POLL_INTERVAL_MS);
    const permit = await context.api.request<UploadPermitDetails | undefined>(
      `/api/lockers/${encodeURIComponent(code)}/upload-permit`,
      { notFound: { kind: 'credential' } },
    );
    // A 204 arrives as undefined: nothing has been scanned yet.
    if (permit?.expiresAt) {
      context.reporter.clearProgress();
      context.reporter.success('Scanned. Uploading…');
      return;
    }
  }

  context.reporter.clearProgress();
  throw new CliError('Gave up waiting for the code in the room to be scanned.', {
    kind: 'not-authorized',
    exitCode: Exit.NotAuthorized,
    recovery: 'locker upload …   (to try again)',
  });
}

/**
 * Asks the server to draw the QR code.
 *
 * The CLI has no dependencies and is meant to keep none; the server already
 * encodes QR codes for the printed cards. If that fails, the link on its own is
 * still enough to get a mentor there, so a missing picture is not a failure.
 */
async function drawQrCode(context: Context, code: string, requestCode: string): Promise<string> {
  try {
    const response = await context.api.requestRaw(
      `/api/lockers/${encodeURIComponent(code)}/upload-approvals/${encodeURIComponent(requestCode)}/qr`,
      { accept: 'text/plain' },
    );
    return await response.text();
  } catch (error) {
    context.diagnostics.record('qr render failed', String(error));
    return '';
  }
}

const unattended = (ticket: ApprovalTicket): CliError =>
  new CliError('A mentor has to approve this upload.', {
    kind: 'not-authorized',
    exitCode: Exit.NotAuthorized,
    recovery: `Open ${ticket.approveUrl} at the desk, then run this again.`,
    detail: { approvalCode: ticket.code, approveUrl: ticket.approveUrl, expiresAt: ticket.expiresAt },
  });

const wrongPlace = (gate: UploadGateProblem): CliError =>
  new CliError(
    gate.verdict === 'WrongNetwork'
      ? "This Dojo only takes uploads from its own network."
      : 'This Dojo is not taking uploads from here right now.',
    {
      kind: 'not-authorized',
      exitCode: Exit.NotAuthorized,
      recovery:
        gate.verdict === 'WrongNetwork'
          ? "Join the Dojo's wifi and try again."
          : 'Ask a mentor what this Dojo needs.',
    },
  );

// Deliberately not unref'd: between two polls the timer is the only thing
// holding the event loop open, and an unref'd one would let Node decide the
// program had finished while a child is still waiting for a mentor.
const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
