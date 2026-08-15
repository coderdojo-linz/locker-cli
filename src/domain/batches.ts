import type { CardDesignDetails, CodeBatchDetails } from '../api/types.js';
import type { Context } from '../runtime/context.js';
import { asDesk } from './desk.js';
import { CliError, Exit, notFoundError } from '../runtime/exit.js';
import { shortId } from '../runtime/format.js';

/**
 * Finding the run of codes, or the card design, somebody named.
 *
 * The same rules the rest of the CLI uses for a project or a Dojo: an id, the
 * short form a listing shows, or the name — and two matches is a refusal
 * listing both rather than a silent pick of the first. Two runs called "Spares"
 * is not unusual, and printing the wrong one wastes a term's card stock.
 */

const pick = <T>(
  items: T[],
  reference: string,
  id: (item: T) => string,
  name: (item: T) => string,
  what: string,
  recovery: string,
): T => {
  const wanted = reference.trim();
  if (wanted.length === 0) throw notFoundError(`No ${what} was named.`, recovery);

  const byId = items.find((item) => id(item) === wanted);
  if (byId) return byId;

  const matches = items.filter((item) =>
    name(item).toLowerCase() === wanted.toLowerCase() ||
    shortId(id(item)) === wanted.toLowerCase() ||
    id(item).startsWith(wanted.toLowerCase()));

  if (matches.length === 1) return matches[0] as T;
  if (matches.length === 0) {
    throw notFoundError(`No ${what} here is called "${reference}".`, recovery);
  }

  throw new CliError(
    `"${reference}" matches ${matches.length}. Use the id instead:\n` +
      matches.map((item) => `  ${shortId(id(item))}  ${name(item)}`).join('\n'),
    { kind: 'validation', exitCode: Exit.Usage, recovery },
  );
};

export async function findBatch(context: Context, reference: string): Promise<CodeBatchDetails> {
  const batches = await asDesk(context, () =>
    context.api.request<CodeBatchDetails[]>('/api/code-batches'));
  return pick(
    batches, reference,
    (batch) => batch.id, (batch) => batch.label,
    'run of codes', 'locker admin batches list',
  );
}

export async function findDesign(context: Context, reference: string): Promise<CardDesignDetails> {
  const designs = await asDesk(context, () =>
    context.api.request<CardDesignDetails[]>('/api/card-designs'));
  return pick(
    designs, reference,
    (design) => design.id, (design) => design.name,
    'card design', 'locker admin designs list',
  );
}
