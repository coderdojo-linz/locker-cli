import type { EventDetails, EventPolicy } from '../api/types.js';
import type { Context } from '../runtime/context.js';
import { asDesk } from './desk.js';
import { CliError, Exit, notFoundError } from '../runtime/exit.js';
import { shortId } from '../runtime/format.js';

/**
 * Finding the Dojo somebody named, or refusing to choose.
 *
 * The same rules as a project: a full id, the short form a listing shows, or the
 * name. Names are not unique — nothing stops two terms both being called
 * "Herbst" — so two matches is an error listing both rather than a silent pick
 * of the first. Guessing would print a term's codes under the wrong heading.
 */
export async function findDojo(context: Context, reference: string): Promise<EventDetails> {
  const wanted = reference.trim();
  if (wanted.length === 0) {
    throw notFoundError('No Dojo was named.', 'locker admin dojos list');
  }

  const dojos = await asDesk(context, () =>
    context.api.request<EventDetails[]>('/api/events'));

  const byId = dojos.find((dojo) => dojo.id === wanted);
  if (byId) return byId;

  const matches = dojos.filter((dojo) =>
    dojo.name.toLowerCase() === wanted.toLowerCase() ||
    shortId(dojo.id) === wanted.toLowerCase() ||
    dojo.id.startsWith(wanted.toLowerCase()));

  if (matches.length === 1) return matches[0] as EventDetails;
  if (matches.length === 0) {
    throw notFoundError(`No Dojo here is called "${reference}".`, 'locker admin dojos list');
  }

  throw new CliError(
    `"${reference}" matches ${matches.length} Dojos. Use the id instead:\n` +
      matches.map((dojo) => `  ${shortId(dojo.id)}  ${dojo.name}`).join('\n'),
    { kind: 'validation', exitCode: Exit.Usage, recovery: 'locker admin dojos list' },
  );
}

/** What the API calls a mode, and what a person reads. */
 
const ModeWords: Record<string, string> = {
  None: 'anybody may upload',
  MentorApproval: 'a mentor says yes each time',
  EventCode: 'the poster on the wall is scanned',
  NetworkMatch: "only from the room's own network",
  ReviewQueue: 'uploads freely, hidden until a mentor looks',
};

/**
 * A rule in one line, which is what a table cell and a success message both want.
 *
 * Built from pieces rather than a sentence per combination: the mode is always
 * said, and the two ceilings only when they are set, so an installation that has
 * only capped sharing does not read as one that has also capped everything else.
 */
export function ruleLine(policy: EventPolicy | null | undefined): string {
  const parts = [ModeWords[policy?.uploadApproval ?? 'None'] ?? String(policy?.uploadApproval ?? 'None')];
  if (policy?.maximumShareMinutes) parts.push(`links up to ${policy.maximumShareMinutes} min`);
  if (policy?.projectRetentionDays) parts.push(`kept ${policy.projectRetentionDays} days`);
  return parts.join(' · ');
}
