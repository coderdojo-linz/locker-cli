import type { CardDesignDetails, CodeBatchDetails, PaperSize } from '../api/types.js';
import { numberOption, optionalString, requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { asDesk, orBlank, requireDeskKey } from '../domain/desk.js';
import { findBatch, findDesign } from '../domain/batches.js';
import { findDojo } from '../domain/dojos.js';
import { downloadPdf } from './adminLockers.js';
import { usageError } from '../runtime/exit.js';
import { formatDate, shortId } from '../runtime/format.js';
import { confirm } from '../runtime/prompt.js';
import { renderPairs, renderTable } from '../runtime/style.js';

/**
 * Runs of codes: making them, and getting them onto paper.
 *
 * A batch is one press run — a label, a count, the paper and design it prints
 * with, and the Dojo it was made for. Everything after making it is a property
 * that can be changed later, because the answer to "which design?" is usually
 * discovered at the printer rather than at the form.
 */
export const adminBatchesListCommand: Command = {
  path: ['admin', 'batches', 'list'],
  summary: 'List the runs of codes',
  usage: 'locker admin batches list [--dojo <dojo>]',
  options: {
    dojo: { type: 'string', description: 'Only runs printed for this Dojo.', placeholder: '<dojo>' },
  },
  examples: ['locker admin batches list', 'locker admin batches list --dojo "Dojo Linz"'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const named = optionalString(input, 'dojo');
    const dojo = named ? await findDojo(context, named) : null;

    const all = await asDesk(context, () =>
      context.api.request<CodeBatchDetails[]>('/api/code-batches'));
    const batches = dojo ? all.filter((batch) => batch.eventId === dojo.id) : all;

    if (batches.length === 0) {
      return {
        human: dojo ? `No runs of codes for "${dojo.name}".` : 'No runs of codes yet.',
        data: [],
      };
    }

    return {
      human: renderTable(
        [
          { header: 'id', max: 10 },
          { header: 'label', max: 30 },
          { header: 'codes', align: 'right' },
          { header: 'each', align: 'right' },
          { header: 'paper' },
          { header: 'dojo', max: 24 },
          { header: 'made' },
        ],
        batches.map((batch) => [
          shortId(batch.id),
          batch.label,
          String(batch.quantity),
          `${batch.storageLimitMb} MB`,
          batch.paper,
          orBlank(batch.eventName),
          formatDate(batch.createdAt),
        ]),
        context.palette,
      ),
      data: batches,
    };
  },
};

export const adminBatchesShowCommand: Command = {
  path: ['admin', 'batches', 'show'],
  summary: 'One run of codes, and the codes in it',
  usage: 'locker admin batches show <batch> [--codes]',
  options: {
    codes: { type: 'boolean', description: 'Print every code, one per line.' },
  },
  examples: ['locker admin batches show "Autumn term"', 'locker admin batches show 3e632c7b --codes'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const batch = await findBatch(
      context,
      requirePositional(input, 0, 'a run of codes', 'locker admin batches list'),
    );

    const pairs: [string, string][] = [
      ['id', batch.id],
      ['label', batch.label],
      ['codes', String(batch.quantity)],
      ['storage each', `${batch.storageLimitMb} MB`],
      ['paper', batch.paper],
      ['dojo', orBlank(batch.eventName) || context.palette.dim('none')],
      ['made', formatDate(batch.createdAt)],
    ];

    // The codes themselves only when asked. A run of 200 would otherwise bury
    // the six facts above it that somebody actually came for.
    const codes = input.values['codes'] === true ? batch.codes : [];
    return {
      human: [
        renderPairs(pairs, context.palette),
        ...(codes.length > 0 ? [codes.join('\n')] : []),
      ].join('\n\n'),
      data: batch,
    };
  },
};

export const adminBatchesNewCommand: Command = {
  path: ['admin', 'batches', 'new'],
  summary: 'Make a run of codes',
  description:
    'Every code becomes an empty locker the first time a child scans it.\n' +
    'The design and paper can be changed afterwards; the count cannot.',
  usage: 'locker admin batches new <label> --count <n> [--dojo <dojo>] [--design <design>]',
  options: {
    count: { type: 'string', description: 'How many codes. 1 to 500.', placeholder: '<n>' },
    storage: { type: 'string', description: 'Storage per locker in MB. Default 200.', placeholder: '<mb>' },
    paper: { type: 'string', description: 'Paper size. Default A4.', placeholder: '<size>' },
    dojo: { type: 'string', description: 'The Dojo these are for.', placeholder: '<dojo>' },
    design: { type: 'string', description: 'Card design, by name or id. Default: plain stickers.', placeholder: '<design>' },
  },
  examples: [
    'locker admin batches new "Autumn term" --count 48 --dojo "Dojo Linz"',
    'locker admin batches new "Spares" --count 12 --design "Projekt-Locker A5"',
  ],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const label = requirePositional(input, 0, 'a label', 'locker admin batches new "Autumn term" --count 48').trim();
    const quantity = numberOption(input, 'count');
    if (quantity === undefined) {
      throw usageError('Say how many codes with --count.', 'locker admin batches new "Autumn term" --count 48');
    }

    const storageLimitMb = numberOption(input, 'storage') ?? 200;
    const paper = (optionalString(input, 'paper') ?? 'A4') as PaperSize;
    const namedDojo = optionalString(input, 'dojo');
    const namedDesign = optionalString(input, 'design');
    const dojo = namedDojo ? await findDojo(context, namedDojo) : null;
    const design = namedDesign ? await findDesign(context, namedDesign) : null;

    const body = {
      label,
      quantity,
      storageLimitMb,
      paper,
      cardDesignId: design?.id ?? null,
      eventId: dojo?.id ?? null,
    };

    if (context.dryRun) {
      return {
        human:
          `Would make ${quantity} codes labelled "${label}"` +
          `${dojo ? ` for "${dojo.name}"` : ''}, ${storageLimitMb} MB each, on ${paper}` +
          `${design ? `, printing "${design.name}"` : ''}.`,
        data: { dryRun: true, ...body },
      };
    }

    const batch = await asDesk(context, () =>
      context.api.request<CodeBatchDetails>('/api/code-batches', { method: 'POST', body }));
    context.reporter.success(`Made ${batch.quantity} codes: "${batch.label}".`);
    context.reporter.note('locker admin batches print — to get them onto paper');
    return {
      human: [`${shortId(batch.id)}  ${batch.label}`, ...batch.codes.slice(0, 3)].join('\n'),
      data: batch,
    };
  },
};

export const adminBatchesRemoveCommand: Command = {
  path: ['admin', 'batches', 'rm'],
  summary: 'Take a run of codes off the list',
  description:
    'The codes keep working and every locker they made stays. Only the record\n' +
    'of the press run goes.',
  usage: 'locker admin batches rm <batch>',
  examples: ['locker admin batches rm "Autumn term" --dry-run'],
  destructive: true,
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const batch = await findBatch(
      context,
      requirePositional(input, 0, 'a run of codes', 'locker admin batches list'),
    );

    if (context.dryRun) {
      return {
        human: `Would forget the run "${batch.label}". Its ${batch.quantity} codes keep working.`,
        data: { dryRun: true, id: batch.id, label: batch.label },
      };
    }

    await confirm(
      `Take "${batch.label}" off the list, keeping its ${batch.quantity} codes working`,
      context,
      `locker admin batches rm ${JSON.stringify(batch.label)}`,
    );
    await asDesk(context, () =>
      context.api.request<void>(`/api/code-batches/${batch.id}`, { method: 'DELETE' }));
    context.reporter.success(`Forgot the run "${batch.label}".`);
    return { human: '', data: { id: batch.id, label: batch.label, deleted: true } };
  },
};

/**
 * What a run prints with, changed after the fact.
 *
 * One command rather than four, because at the printer these are one decision:
 * somebody is looking at a proof and adjusting until it comes out right.
 */
export const adminBatchesSetCommand: Command = {
  path: ['admin', 'batches', 'set'],
  summary: 'Change a run of codes: its label, paper, design, or Dojo',
  usage: 'locker admin batches set <batch> [--label <text>] [--paper <size>] [--design <design>] [--dojo <dojo>]',
  options: {
    label: { type: 'string', description: 'What the run is called.', placeholder: '<text>' },
    paper: { type: 'string', description: 'Paper size it prints on.', placeholder: '<size>' },
    design: { type: 'string', description: 'Card design, or "stickers" for none.', placeholder: '<design>' },
    dojo: { type: 'string', description: 'The Dojo it belongs to, or "none".', placeholder: '<dojo>' },
  },
  examples: [
    'locker admin batches set "Autumn term" --paper A3',
    'locker admin batches set "Autumn term" --design "Projekt-Locker A5"',
    'locker admin batches set "Spares" --dojo none',
  ],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const batch = await findBatch(
      context,
      requirePositional(input, 0, 'a run of codes', 'locker admin batches list'),
    );

    const label = optionalString(input, 'label')?.trim();
    const paper = optionalString(input, 'paper')?.trim();
    const design = optionalString(input, 'design')?.trim();
    const dojo = optionalString(input, 'dojo')?.trim();
    if (!label && !paper && !design && !dojo) {
      throw usageError(
        'Nothing to change. Give --label, --paper, --design, or --dojo.',
        'locker admin batches set "Autumn term" --paper A3',
      );
    }

    // Resolved before anything is written, so a mistyped design does not leave
    // the paper already changed.
    const chosenDesign = design && design.toLowerCase() !== 'stickers'
      ? await findDesign(context, design)
      : null;
    const chosenDojo = dojo && dojo.toLowerCase() !== 'none'
      ? await findDojo(context, dojo)
      : null;

    const changes: string[] = [];
    if (label) changes.push(`label "${label}"`);
    if (paper) changes.push(`paper ${paper}`);
    if (design) changes.push(`design ${chosenDesign ? `"${chosenDesign.name}"` : 'plain stickers'}`);
    if (dojo) changes.push(`Dojo ${chosenDojo ? `"${chosenDojo.name}"` : 'none'}`);

    if (context.dryRun) {
      return {
        human: `Would set ${changes.join(', ')} on "${batch.label}".`,
        data: { dryRun: true, id: batch.id, changes },
      };
    }

    // One PUT per property, because that is the shape the API offers. Ordered
    // so the label goes last: it is what every later message names the run by.
    let updated = batch;
    const put = (path: string, body: unknown) =>
      asDesk(context, () =>
        context.api.request<CodeBatchDetails>(`/api/code-batches/${batch.id}/${path}`, {
          method: 'PUT',
          body,
        }));

    if (paper) updated = await put('paper', { paper });
    if (design) updated = await put('design', { cardDesignId: chosenDesign?.id ?? null });
    if (dojo) updated = await put('event', { eventId: chosenDojo?.id ?? null });
    if (label) updated = await put('label', { label });

    context.reporter.success(`Changed ${changes.join(', ')}.`);
    return { human: '', data: updated };
  },
};

export const adminBatchesPrintCommand: Command = {
  path: ['admin', 'batches', 'print'],
  summary: 'Download a run of codes as a PDF',
  description:
    'The same sheets the desk produces. --both-sides needs a design that has a\n' +
    'back; print double-sided, flipped on the long edge.',
  usage: 'locker admin batches print <batch> [--out <file>] [--per-page <n>] [--both-sides]',
  options: {
    out: { type: 'string', description: 'Where to write the PDF.', placeholder: '<file>' },
    'per-page': { type: 'string', description: 'Cards to a sheet.', placeholder: '<n>' },
    paper: { type: 'string', description: 'Override the paper size for this print.', placeholder: '<size>' },
    'both-sides': { type: 'boolean', description: 'Fronts and backs, mirrored to line up.' },
    'no-crop-marks': { type: 'boolean', description: 'Leave the cut lines off.' },
  },
  examples: [
    'locker admin batches print "Autumn term"',
    'locker admin batches print "Autumn term" --per-page 8 --out sheets.pdf',
  ],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const batch = await findBatch(
      context,
      requirePositional(input, 0, 'a run of codes', 'locker admin batches list'),
    );

    const query = new URLSearchParams();
    const perPage = optionalString(input, 'per-page');
    if (perPage) query.set('cardsPerPage', perPage);
    query.set('paper', optionalString(input, 'paper') ?? batch.paper);
    query.set('cropMarks', String(input.values['no-crop-marks'] !== true));
    if (batch.cardDesignId) query.set('cardDesignId', batch.cardDesignId);
    if (input.values['both-sides'] === true) query.set('bothSides', 'true');

    const out = optionalString(input, 'out') ?? `codes-${shortId(batch.id)}.pdf`;
    return downloadPdf(
      context,
      `/api/code-batches/${batch.id}/print.pdf?${query.toString()}`,
      out,
      `${batch.quantity} codes from "${batch.label}"`,
    );
  },
};

export const adminBatchCommands: Command[] = [
  adminBatchesListCommand,
  adminBatchesShowCommand,
  adminBatchesNewCommand,
  adminBatchesSetCommand,
  adminBatchesPrintCommand,
  adminBatchesRemoveCommand,
];

export type { CardDesignDetails };
