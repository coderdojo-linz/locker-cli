import type { PendingApproval, PendingReview } from '../api/types.js';
import { optionalString, requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { asDesk, orBlank, requireDeskKey } from '../domain/desk.js';
import { notFoundError } from '../runtime/exit.js';
import { formatBytes, formatDate, shortId } from '../runtime/format.js';
import { renderTable } from '../runtime/style.js';

/**
 * The two things a mentor is asked to say yes to, and they are not the same.
 *
 * An upload waiting for approval has a child standing at a screen that will not
 * move until somebody answers. A project in the review queue is already saved
 * and nobody is blocked; it is the afternoon's reading. The desk shows them as
 * two lists for that reason, and so does this.
 */
export const adminReviewWaitingCommand: Command = {
  path: ['admin', 'review', 'waiting'],
  summary: 'Uploads waiting for a mentor to say yes',
  description: 'A child is at a screen for each of these. They expire on their own.',
  usage: 'locker admin review waiting',
  examples: ['locker admin review waiting', 'locker admin review waiting --json'],
  async run(context): Promise<CommandResult> {
    requireDeskKey(context);
    const waiting = await asDesk(context, () =>
      context.api.request<PendingApproval[]>('/api/upload-approvals'));

    if (waiting.length === 0) return { human: 'Nobody is waiting.', data: [] };

    return {
      human: renderTable(
        [
          { header: 'code' },
          { header: 'locker' },
          { header: 'project', max: 28 },
          { header: 'files', align: 'right' },
          { header: 'size', align: 'right' },
          { header: 'dojo', max: 20 },
          { header: 'until' },
        ],
        waiting.map((item) => [
          item.code,
          item.lockerCode,
          orBlank(item.projectName) || context.palette.dim('unnamed'),
          String(item.fileCount),
          formatBytes(item.totalBytes),
          orBlank(item.eventName),
          formatDate(item.expiresAt),
        ]),
        context.palette,
      ),
      data: waiting,
    };
  },
};

export const adminReviewDecideCommand: Command = {
  path: ['admin', 'review', 'decide'],
  summary: 'Say yes or no to a waiting upload',
  usage: 'locker admin review decide <code> --yes-to | --no-to',
  options: {
    'yes-to': { type: 'boolean', description: 'Let this upload through.' },
    'no-to': { type: 'boolean', description: 'Refuse it.' },
  },
  examples: [
    'locker admin review decide 7QK2M4 --yes-to',
    'locker admin review decide 7QK2M4 --no-to',
  ],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const code = requirePositional(input, 0, 'an approval code', 'locker admin review waiting');
    const approve = readDecision(context, input, 'locker admin review decide 7QK2M4 --yes-to');

    if (context.dryRun) {
      return {
        human: `Would ${approve ? 'approve' : 'refuse'} ${code}.`,
        data: { dryRun: true, code, approve },
      };
    }

    const decided = await asDesk(context, () =>
      context.api.request<PendingApproval>(`/api/upload-approvals/${encodeURIComponent(code)}/decision`, {
        method: 'POST',
        body: { approve },
        notFound: {
          kind: 'resource',
          message: `Nothing is waiting under ${code}. It may have expired.`,
          recovery: 'locker admin review waiting',
        },
      }));

    context.reporter.success(
      approve
        ? `Approved. ${decided.lockerName} can save now.`
        : `Refused. ${decided.lockerName} was told no.`,
    );
    return { human: '', data: decided };
  },
};

/**
 * Work that is saved but not yet shown to anybody else.
 *
 * At a Dojo that reviews, a child is never blocked — they upload and it lands.
 * What waits is everybody else's view of it, which is why this list is the
 * afternoon's reading rather than something anybody is standing over.
 */
export const adminReviewQueueCommand: Command = {
  path: ['admin', 'review', 'queue'],
  summary: 'Projects saved but not yet shown to anybody else',
  usage: 'locker admin review queue [--all]',
  options: {
    all: { type: 'boolean', description: 'Include the ones already decided.' },
  },
  examples: ['locker admin review queue'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const pendingOnly = input.values['all'] !== true;
    const queue = await asDesk(context, () =>
      context.api.request<PendingReview[]>(`/api/reviews?pendingOnly=${pendingOnly}`));

    if (queue.length === 0) return { human: 'Nothing is waiting to be looked at.', data: [] };

    return {
      human: renderTable(
        [
          { header: 'id', max: 10 },
          { header: 'project', max: 30 },
          { header: 'locker' },
          { header: 'files', align: 'right' },
          { header: 'size', align: 'right' },
          { header: 'dojo', max: 20 },
          { header: 'state' },
          { header: 'saved' },
        ],
        queue.map((item) => [
          shortId(item.projectId),
          item.projectName,
          item.lockerCode,
          String(item.fileCount),
          formatBytes(item.totalBytes),
          orBlank(item.eventName),
          item.state,
          formatDate(item.createdAt),
        ]),
        context.palette,
      ),
      data: queue,
    };
  },
};

export const adminReviewPublishCommand: Command = {
  path: ['admin', 'review', 'publish'],
  summary: 'Let a reviewed project be seen, or keep it hidden',
  usage: 'locker admin review publish <project> --yes-to | --no-to [--note <text>]',
  options: {
    'yes-to': { type: 'boolean', description: 'Show it to everybody.' },
    'no-to': { type: 'boolean', description: 'Keep it hidden.' },
    note: { type: 'string', description: 'A note for the child, saved with the decision.', placeholder: '<text>' },
  },
  examples: [
    'locker admin review publish 3e632c7b --yes-to',
    'locker admin review publish 3e632c7b --no-to --note "Please remove the photo of your class"',
  ],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const reference = requirePositional(input, 0, 'a project', 'locker admin review queue');
    const approve = readDecision(context, input, 'locker admin review publish 3e632c7b --yes-to');
    const note = optionalString(input, 'note');

    // Resolved against the queue rather than taken as an id, so the short form
    // a listing prints is what a reader can paste back.
    const queue = await asDesk(context, () =>
      context.api.request<PendingReview[]>('/api/reviews?pendingOnly=false'));
    const wanted = reference.trim().toLowerCase();
    const project = queue.find((item) =>
      item.projectId === reference ||
      shortId(item.projectId) === wanted ||
      item.projectName.toLowerCase() === wanted);
    if (!project) {
      throw notFoundError(`Nothing in the queue matches "${reference}".`, 'locker admin review queue');
    }

    if (context.dryRun) {
      return {
        human: `Would ${approve ? 'publish' : 'hide'} "${project.projectName}".`,
        data: { dryRun: true, projectId: project.projectId, approve, note: note ?? null },
      };
    }

    await asDesk(context, () =>
      context.api.request<void>(`/api/reviews/${project.projectId}/decision`, {
        method: 'POST',
        body: { approve, note: note ?? null },
      }));

    context.reporter.success(
      approve
        ? `"${project.projectName}" can be seen by anybody with a link.`
        : `"${project.projectName}" stays hidden.`,
    );
    return { human: '', data: { projectId: project.projectId, approve, note: note ?? null } };
  },
};

/**
 * Yes and no as two flags rather than one that defaults.
 *
 * A default here would be a default about somebody else's work: a script that
 * forgot the flag would quietly approve everything it touched, or quietly refuse
 * it, and either is worse than being told to say which.
 */
function readDecision(
  context: Parameters<NonNullable<Command['run']>>[0],
  input: Parameters<NonNullable<Command['run']>>[1],
  usage: string,
): boolean {
  const yes = input.values['yes-to'] === true;
  const no = input.values['no-to'] === true;
  if (yes && no) {
    throw notFoundError('Give --yes-to or --no-to, not both.', usage);
  }
  if (!yes && !no) {
    throw notFoundError('Say which: --yes-to or --no-to.', usage);
  }
  return yes;
}

export const adminReviewCommands: Command[] = [
  adminReviewWaitingCommand,
  adminReviewDecideCommand,
  adminReviewQueueCommand,
  adminReviewPublishCommand,
];
