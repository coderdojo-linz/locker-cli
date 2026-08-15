import type { LockerCodeReplacement, LockerDetails, LockerSummary } from '../api/types.js';
import { optionalString, requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { normalizeCode } from '../runtime/code.js';
import { asDesk, orBlank, requireDeskKey } from '../domain/desk.js';
import { usageError } from '../runtime/exit.js';
import { formatBytes, formatDate, shortId } from '../runtime/format.js';
import { confirm } from '../runtime/prompt.js';
import { renderPairs, renderTable } from '../runtime/style.js';

/**
 * Every locker in the installation, from a terminal.
 *
 * The desk's own list, minus the desk. What a mentor comes to this for is
 * usually one of two things: finding the locker a child in front of them is
 * holding, or reading the whole set into something else — which is why the
 * search is the same one the desk uses and `--json` is a first-class answer
 * rather than a debugging aid.
 */
export const adminLockersListCommand: Command = {
  path: ['admin', 'lockers', 'list'],
  summary: 'List or search every locker',
  description:
    'Searches codes, names, owners, project names and file names — the same\n' +
    'search the desk does. With no term, lists them most recently used first.',
  usage: 'locker admin lockers list [search] [--status <status>]',
  options: {
    status: {
      type: 'string',
      description: 'Only lockers in this state: active, waiting, quiet, sticker lost.',
      placeholder: '<status>',
    },
  },
  examples: [
    'locker admin lockers list',
    'locker admin lockers list "Blue Otter"',
    'locker admin lockers list --status waiting --json',
  ],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const search = input.positionals[0]?.trim();
    const status = optionalString(input, 'status')?.trim().toLowerCase();

    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    const all = await asDesk(context, () =>
      context.api.request<LockerSummary[]>(`/api/lockers${query}`));
    const lockers = status ? all.filter((locker) => locker.status.toLowerCase() === status) : all;

    if (lockers.length === 0) {
      return { human: search ? `No lockers match "${search}".` : 'No lockers yet.', data: [] };
    }

    const rows = lockers.map((locker) => [
      locker.code,
      locker.name,
      orBlank(locker.ownerName),
      locker.status,
      String(locker.projectCount),
      formatBytes(locker.usedBytes),
      orBlank(locker.eventName),
      formatDate(locker.lastUploadAt),
    ]);

    return {
      human: renderTable(
        [
          { header: 'code' },
          { header: 'name', max: 28 },
          { header: 'owner', max: 20 },
          { header: 'status' },
          { header: 'projects', align: 'right' },
          { header: 'size', align: 'right' },
          { header: 'dojo', max: 24 },
          { header: 'last upload' },
        ],
        rows,
        context.palette,
      ),
      data: lockers,
    };
  },
};

export const adminLockersShowCommand: Command = {
  path: ['admin', 'lockers', 'show'],
  summary: 'Everything about one locker',
  usage: 'locker admin lockers show <code>',
  examples: ['locker admin lockers show K7F29QB3'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const code = normalizeCode(requirePositional(input, 0, 'a locker code', 'locker admin lockers show K7F29QB3'));
    const locker = await asDesk(context, () =>
      context.api.request<LockerDetails>(`/api/lockers/${encodeURIComponent(code)}`, {
        notFound: { kind: 'resource', message: `No locker here has the code ${code}.`, recovery: 'locker admin lockers list' },
      }));

    const pairs: [string, string][] = [
      ['code', locker.code],
      ['name', locker.name],
      ['owner', orBlank(locker.ownerName) || context.palette.dim('nobody named')],
      ['status', locker.status],
      ['used', `${formatBytes(locker.usedBytes)} of ${formatBytes(locker.storageLimitBytes)}`],
      ['projects', String(locker.projects.length)],
      ['last activity', formatDate(locker.lastActivityAt)],
    ];

    const projects = locker.projects.map((project) => [
      shortId(project.id),
      project.name,
      String(project.files.length),
      formatBytes(project.files.reduce((total, file) => total + file.size, 0)),
      project.reviewState === 'NotRequired' ? '' : project.reviewState,
    ]);

    return {
      human: [
        renderPairs(pairs, context.palette),
        projects.length === 0
          ? context.palette.dim('  nothing in it yet')
          : renderTable(
            [
              { header: 'id', max: 10 },
              { header: 'project', max: 36 },
              { header: 'files', align: 'right' },
              { header: 'size', align: 'right' },
              { header: 'review' },
            ],
            projects,
            context.palette,
          ),
      ].join('\n\n'),
      data: locker,
    };
  },
};

export const adminLockersRenameCommand: Command = {
  path: ['admin', 'lockers', 'rename'],
  summary: "Change a locker's name or the owner written on it",
  description:
    'The name is the one a child chose and sees; the owner is what the desk\n' +
    'writes beside it. Giving only one leaves the other as it is.',
  usage: 'locker admin lockers rename <code> [name] [--owner <name>]',
  options: {
    owner: { type: 'string', description: 'The owner written beside the name.', placeholder: '<name>' },
  },
  examples: [
    'locker admin lockers rename K7F29QB3 "Blue Otter"',
    'locker admin lockers rename K7F29QB3 --owner "Lena"',
  ],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const code = normalizeCode(requirePositional(input, 0, 'a locker code', 'locker admin lockers rename K7F29QB3 "New name"'));
    const name = input.positionals[1]?.trim();
    const owner = optionalString(input, 'owner')?.trim();
    if (name === undefined && owner === undefined) {
      throw usageError(
        'Nothing to change. Give a name, an --owner, or both.',
        'locker admin lockers rename K7F29QB3 "Blue Otter"',
      );
    }

    const path = `/api/lockers/${encodeURIComponent(code)}`;
    // Read first: the API takes both fields together, so changing one means
    // sending the other back unchanged rather than blanking it.
    const before = await asDesk(context, () =>
      context.api.request<LockerDetails>(path, {
        notFound: { kind: 'resource', message: `No locker here has the code ${code}.`, recovery: 'locker admin lockers list' },
      }));

    const body = { name: name ?? before.name, ownerName: owner ?? before.ownerName ?? '' };

    if (context.dryRun) {
      return {
        human: `Would rename ${code} to "${body.name}"${body.ownerName ? ` (${body.ownerName})` : ''}.`,
        data: { dryRun: true, code, ...body },
      };
    }

    const locker = await asDesk(context, () =>
      context.api.request<LockerDetails>(path, { method: 'PUT', body }));
    context.reporter.success(`${locker.code} is now "${locker.name}".`);
    return { human: '', data: locker };
  },
};

export const adminLockersReplaceCodeCommand: Command = {
  path: ['admin', 'lockers', 'replace-code'],
  summary: 'Attach a new code to a locker whose card was lost',
  description:
    'The locker and everything in it stays; only the code on the front changes.\n' +
    'By default the old code stops working — which is the point when a card has\n' +
    'gone missing. --keep-old leaves both working, for a card that was replaced\n' +
    'rather than lost.',
  usage: 'locker admin lockers replace-code <code> <new code> [--keep-old]',
  options: {
    'keep-old': { type: 'boolean', description: 'Leave the old code working as well.' },
  },
  examples: [
    'locker admin lockers replace-code K7F29QB3 T4WDH8LM',
    'locker admin lockers replace-code K7F29QB3 T4WDH8LM --keep-old',
  ],
  destructive: true,
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const usage = 'locker admin lockers replace-code K7F29QB3 T4WDH8LM';
    const code = normalizeCode(requirePositional(input, 0, 'the locker code', usage));
    const newCode = normalizeCode(requirePositional(input, 1, 'the new code', usage));
    const keepOld = input.values['keep-old'] === true;

    if (context.dryRun) {
      return {
        human: `Would attach ${newCode} to ${code}${keepOld ? ', keeping both' : ', retiring the old one'}.`,
        data: { dryRun: true, code, newCode, keepOldCode: keepOld },
      };
    }

    if (!keepOld) {
      await confirm(
        `Retire ${code} and attach ${newCode}, so the old card stops opening this locker`,
        context,
        `locker admin lockers replace-code ${code} ${newCode}`,
      );
    }

    const result = await asDesk(context, () =>
      context.api.request<LockerCodeReplacement>(
        `/api/lockers/${encodeURIComponent(code)}/replace-code`,
        {
          method: 'POST',
          body: { newCode, keepOldCode: keepOld },
          notFound: { kind: 'resource', message: `No locker here has the code ${code}.`, recovery: 'locker admin lockers list' },
        },
      ));

    context.reporter.success(
      result.oldCodeRetired
        ? `${result.newCode} now opens this locker. ${result.oldCode} no longer does.`
        : `${result.newCode} now opens this locker, and ${result.oldCode} still does.`,
    );
    return { human: '', data: result };
  },
};

export const adminLockersEmptyCommand: Command = {
  path: ['admin', 'lockers', 'empty'],
  summary: 'Delete everything inside a locker',
  description:
    'Removes every project and every file. The locker and its code stay, ready\n' +
    'for the next child. Nothing here can be undone.',
  usage: 'locker admin lockers empty <code>',
  examples: ['locker admin lockers empty K7F29QB3 --dry-run', 'locker admin lockers empty K7F29QB3'],
  destructive: true,
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const code = normalizeCode(requirePositional(input, 0, 'a locker code', 'locker admin lockers empty K7F29QB3'));
    const path = `/api/lockers/${encodeURIComponent(code)}`;
    const before = await asDesk(context, () =>
      context.api.request<LockerDetails>(path, {
        notFound: { kind: 'resource', message: `No locker here has the code ${code}.`, recovery: 'locker admin lockers list' },
      }));
    const files = before.projects.reduce((total, project) => total + project.files.length, 0);

    if (context.dryRun) {
      return {
        human:
          `Would empty ${code} ("${before.name}"): ${before.projects.length} projects, ` +
          `${files} files, ${formatBytes(before.usedBytes)}.`,
        data: { dryRun: true, code, projects: before.projects.length, files },
      };
    }

    await confirm(
      `Permanently delete ${before.projects.length} projects and ${files} files from ` +
      `${code} ("${before.name}")`,
      context,
      `locker admin lockers empty ${code}`,
    );

    const emptied = await asDesk(context, () =>
      context.api.request<LockerDetails>(`${path}/contents`, { method: 'DELETE' }));
    context.reporter.success(`${code} is empty.`);
    return { human: '', data: emptied };
  },
};

/**
 * The card for one locker, as a PDF.
 *
 * The same sheet the desk prints, for the case it exists to serve: a child has
 * lost their card and a mentor wants one code on paper rather than a batch.
 */
export const adminLockersPrintCommand: Command = {
  path: ['admin', 'lockers', 'print'],
  summary: "Download one locker's card as a PDF",
  usage: 'locker admin lockers print <code> [--out <file>] [--per-page <n>]',
  options: {
    out: { type: 'string', description: 'Where to write the PDF.', placeholder: '<file>' },
    'per-page': { type: 'string', description: 'Cards to a sheet. Default 24.', placeholder: '<n>' },
  },
  examples: ['locker admin lockers print K7F29QB3', 'locker admin lockers print K7F29QB3 --out card.pdf'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const code = normalizeCode(requirePositional(input, 0, 'a locker code', 'locker admin lockers print K7F29QB3'));
    const perPage = optionalString(input, 'per-page') ?? '24';
    const out = optionalString(input, 'out') ?? `locker-${code}.pdf`;
    return downloadPdf(
      context,
      `/api/lockers/${encodeURIComponent(code)}/print.pdf?cardsPerPage=${encodeURIComponent(perPage)}`,
      out,
      `the card for ${code}`,
    );
  },
};

export const adminLockerCommands: Command[] = [
  adminLockersListCommand,
  adminLockersShowCommand,
  adminLockersRenameCommand,
  adminLockersReplaceCodeCommand,
  adminLockersPrintCommand,
  adminLockersEmptyCommand,
];

/**
 * Fetches a PDF and writes it, which two commands here do identically.
 *
 * Through `requestRaw` rather than `request`, because the body is bytes: parsing
 * it as JSON would fail on the first one and succeed on nothing.
 */
export async function downloadPdf(
  context: Parameters<NonNullable<Command['run']>>[0],
  path: string,
  out: string,
  what: string,
): Promise<CommandResult> {
  if (context.dryRun) {
    return { human: `Would write ${what} to ${out}.`, data: { dryRun: true, out } };
  }

  const response = await asDesk(context, () =>
    context.api.requestRaw(path, { accept: 'application/pdf' }));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { writeFile } = await import('node:fs/promises');
  await writeFile(out, bytes);

  context.reporter.success(`Wrote ${out} (${formatBytes(bytes.byteLength)}).`);
  return { human: '', data: { path: out, bytes: bytes.byteLength } };
}
