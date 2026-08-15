import type { DefaultPolicyDetails, EventDetails, EventPolicy } from '../api/types.js';
import { numberOption, optionalString, requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { asDesk, orBlank, requireDeskKey } from '../domain/desk.js';
import { findDojo, ruleLine } from '../domain/dojos.js';
import { usageError } from '../runtime/exit.js';
import { formatDate, shortId } from '../runtime/format.js';
import { confirm } from '../runtime/prompt.js';
import { renderPairs, renderTable } from '../runtime/style.js';

/**
 * A Dojo, from the terminal.
 *
 * A Dojo is the subject the desk is organised around: codes are printed for
 * one, lockers belong to one, and the rules a child meets when they upload are
 * its rules unless the installation's own are being followed. These commands
 * follow that shape rather than the endpoints' — `rules` is a property of a
 * Dojo here, not a page of its own.
 */
export const adminDojosListCommand: Command = {
  path: ['admin', 'dojos', 'list'],
  summary: 'List the Dojos',
  usage: 'locker admin dojos list',
  examples: ['locker admin dojos list', 'locker admin dojos list --json'],
  async run(context): Promise<CommandResult> {
    requireDeskKey(context);
    const dojos = await asDesk(context, () =>
      context.api.request<EventDetails[]>('/api/events'));

    if (dojos.length === 0) {
      context.reporter.note(context.palette.dim('Try: locker admin dojos new "Dojo Linz, autumn term"'));
      return { human: 'No Dojos yet.', data: [] };
    }

    return {
      human: renderTable(
        [
          { header: 'id', max: 10 },
          { header: 'dojo', max: 32 },
          { header: 'batches', align: 'right' },
          { header: 'codes', align: 'right' },
          { header: 'rules', max: 34 },
          { header: 'created' },
        ],
        dojos.map((dojo) => [
          shortId(dojo.id),
          dojo.name,
          String(dojo.batchCount),
          String(dojo.codeCount),
          dojo.usesDefaultPolicy === false ? ruleLine(dojo.policy) : 'follows the default',
          formatDate(dojo.createdAt),
        ]),
        context.palette,
      ),
      data: dojos,
    };
  },
};

export const adminDojosShowCommand: Command = {
  path: ['admin', 'dojos', 'show'],
  summary: 'One Dojo, and the rules a child meets there',
  usage: 'locker admin dojos show <dojo>',
  examples: ['locker admin dojos show "Dojo Linz, autumn term"'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const dojo = await findDojo(
      context,
      requirePositional(input, 0, 'a Dojo', 'locker admin dojos list'),
    );

    const pairs: [string, string][] = [
      ['id', dojo.id],
      ['dojo', dojo.name],
      ['batches', String(dojo.batchCount)],
      ['codes', String(dojo.codeCount)],
      ['rules', dojo.usesDefaultPolicy === false ? 'its own' : 'the installation default'],
      ['in force', ruleLine(dojo.policy)],
      ['created', formatDate(dojo.createdAt)],
    ];
    // Only when there is one: a Dojo whose rule needs no poster has no token,
    // and printing an empty row would look like something had gone missing.
    if (dojo.eventCodeToken) {
      pairs.push(['poster', `${context.origin}/e/${dojo.eventCodeToken}`]);
    }

    return { human: renderPairs(pairs, context.palette), data: dojo };
  },
};

export const adminDojosNewCommand: Command = {
  path: ['admin', 'dojos', 'new'],
  summary: 'Make a Dojo',
  usage: 'locker admin dojos new <name>',
  examples: ['locker admin dojos new "Dojo Linz, autumn term"'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const name = requirePositional(input, 0, 'a name', 'locker admin dojos new "Dojo Linz"').trim();

    if (context.dryRun) {
      return { human: `Would make a Dojo called "${name}".`, data: { dryRun: true, name } };
    }

    const dojo = await asDesk(context, () =>
      context.api.request<EventDetails>('/api/events', { method: 'POST', body: { name } }));
    context.reporter.success(`Made "${dojo.name}".`);
    return { human: `${shortId(dojo.id)}  ${dojo.name}`, data: dojo };
  },
};

export const adminDojosRenameCommand: Command = {
  path: ['admin', 'dojos', 'rename'],
  summary: 'Give a Dojo a different name',
  usage: 'locker admin dojos rename <dojo> <new name>',
  examples: ['locker admin dojos rename "Dojo Linz" "Dojo Linz, autumn term"'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const usage = 'locker admin dojos rename "Dojo Linz" "New name"';
    const dojo = await findDojo(context, requirePositional(input, 0, 'a Dojo', usage));
    const name = requirePositional(input, 1, 'a new name', usage).trim();

    if (context.dryRun) {
      return {
        human: `Would rename "${dojo.name}" to "${name}".`,
        data: { dryRun: true, id: dojo.id, from: dojo.name, to: name },
      };
    }

    const renamed = await asDesk(context, () =>
      context.api.request<EventDetails>(`/api/events/${dojo.id}`, { method: 'PUT', body: { name } }));
    context.reporter.success(`Renamed to "${renamed.name}".`);
    return { human: '', data: renamed };
  },
};

export const adminDojosRemoveCommand: Command = {
  path: ['admin', 'dojos', 'rm'],
  summary: 'Forget a Dojo',
  description:
    'The runs of codes printed for it stay, belonging to no Dojo, and every\n' +
    'locker they made keeps working. Only the heading goes.',
  usage: 'locker admin dojos rm <dojo>',
  examples: ['locker admin dojos rm "Dojo Linz" --dry-run'],
  destructive: true,
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const dojo = await findDojo(
      context,
      requirePositional(input, 0, 'a Dojo', 'locker admin dojos list'),
    );

    if (context.dryRun) {
      return {
        human:
          `Would forget "${dojo.name}". Its ${dojo.batchCount} runs of codes would stay, ` +
          'belonging to no Dojo.',
        data: { dryRun: true, id: dojo.id, name: dojo.name, batches: dojo.batchCount },
      };
    }

    await confirm(
      `Forget "${dojo.name}", leaving its ${dojo.batchCount} runs of codes without a Dojo`,
      context,
      `locker admin dojos rm ${JSON.stringify(dojo.name)}`,
    );
    await asDesk(context, () =>
      context.api.request<void>(`/api/events/${dojo.id}`, { method: 'DELETE' }));
    context.reporter.success(`Forgot "${dojo.name}".`);
    return { human: '', data: { id: dojo.id, name: dojo.name, deleted: true } };
  },
};

/**
 * What a Dojo asks for before a child's work goes in.
 *
 * Reads with no arguments and writes with them, because "show me the rule" and
 * "change the rule" are the same subject and a reader looking for one finds the
 * other. Naming a Dojo scopes it to that Dojo; leaving it out is the
 * installation's own rule, which every Dojo follows unless it says otherwise.
 */
export const adminDojosRulesCommand: Command = {
  path: ['admin', 'dojos', 'rules'],
  summary: "Show or change what a Dojo asks for before an upload",
  description:
    'With no --dojo, this is the installation\'s rule, which every Dojo follows\n' +
    'unless it states its own. With one, it is that Dojo\'s.\n\n' +
    'Modes: none (anybody with the code), mentor (a mentor says yes each time),\n' +
    'review (uploads freely, hidden until a mentor looks), poster (the QR on the\n' +
    'wall is scanned), network (only from the room\'s own network).',
  usage: 'locker admin dojos rules [--dojo <dojo>] [--mode <mode>] [--follow-default]',
  options: {
    dojo: { type: 'string', description: 'The Dojo, rather than the installation.', placeholder: '<dojo>' },
    mode: { type: 'string', description: 'none, mentor, event-code, or network.', placeholder: '<mode>' },
    'approval-minutes': { type: 'string', description: 'How long a mentor\'s yes lasts.', placeholder: '<n>' },
    'share-minutes': { type: 'string', description: 'Longest a share link may last.', placeholder: '<n>' },
    'keep-days': { type: 'string', description: 'Delete projects after this many days.', placeholder: '<n>' },
    'follow-default': { type: 'boolean', description: 'Put this Dojo back on the installation\'s rule.' },
  },
  examples: [
    'locker admin dojos rules',
    'locker admin dojos rules --dojo "Dojo Linz"',
    'locker admin dojos rules --mode mentor --approval-minutes 15',
    'locker admin dojos rules --dojo "Dojo Linz" --follow-default',
  ],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const named = optionalString(input, 'dojo');
    const mode = optionalString(input, 'mode');
    const followDefault = input.values['follow-default'] === true;
    const approvalMinutes = numberOption(input, 'approval-minutes');
    const shareMinutes = numberOption(input, 'share-minutes');
    const keepDays = numberOption(input, 'keep-days');
    const changing = mode !== undefined || followDefault ||
      approvalMinutes !== undefined || shareMinutes !== undefined || keepDays !== undefined;

    if (followDefault && !named) {
      throw usageError(
        '--follow-default is something one Dojo does. The installation has no default to follow.',
        'locker admin dojos rules --dojo "Dojo Linz" --follow-default',
      );
    }

    const dojo = named ? await findDojo(context, named) : null;

    if (!changing) {
      return dojo
        ? {
          human: renderPairs(
            [
              ['dojo', dojo.name],
              ['rules', dojo.usesDefaultPolicy === false ? 'its own' : 'the installation default'],
              ['in force', ruleLine(dojo.policy)],
            ],
            context.palette,
          ),
          data: dojo,
        }
        : await showInstallationRule(context);
    }

    const target = dojo
      ? { ...(dojo.ownPolicy ?? dojo.policy ?? {}) }
      : { ...((await installationRule(context)).policy ?? {}) };

    if (mode !== undefined) target.uploadApproval = readMode(mode);
    if (approvalMinutes !== undefined) target.approvalMinutes = approvalMinutes;
    if (shareMinutes !== undefined) target.maximumShareMinutes = shareMinutes;
    if (keepDays !== undefined) target.projectRetentionDays = keepDays;

    const what = dojo ? `"${dojo.name}"` : 'the installation';
    if (context.dryRun) {
      return {
        human: followDefault
          ? `Would put ${what} back on the installation's rule.`
          : `Would set ${what} to: ${ruleLine(target)}`,
        data: { dryRun: true, dojo: dojo?.id ?? null, usesDefault: followDefault, policy: target },
      };
    }

    if (dojo) {
      const updated = await asDesk(context, () =>
        context.api.request<EventDetails>(`/api/events/${dojo.id}/policy`, {
          method: 'PUT',
          body: { usesDefault: followDefault, policy: followDefault ? null : target },
        }));
      context.reporter.success(
        followDefault
          ? `"${updated.name}" follows the installation's rule again.`
          : `"${updated.name}": ${ruleLine(updated.policy)}`,
      );
      return { human: '', data: updated };
    }

    const updated = await asDesk(context, () =>
      context.api.request<DefaultPolicyDetails>('/api/events/default-policy', {
        method: 'PUT',
        body: target,
      }));
    context.reporter.success(`The installation now asks: ${ruleLine(updated.policy)}`);
    context.reporter.note(
      `It reaches ${updated.followingDojos} Dojos and ${updated.lockersWithoutDojo} loose codes.`,
    );
    return { human: '', data: updated };
  },
};

/**
 * A fresh poster token, for when the old one has been photographed and shared.
 *
 * The poster on the wall is a URL a phone scans; rotating it is how a Dojo takes
 * back a code that escaped the room.
 */
export const adminDojosEventCodeCommand: Command = {
  path: ['admin', 'dojos', 'poster'],
  summary: 'Show or reissue the poster a phone scans',
  usage: 'locker admin dojos poster [--dojo <dojo>] [--rotate]',
  options: {
    dojo: { type: 'string', description: 'The Dojo, rather than the installation.', placeholder: '<dojo>' },
    rotate: { type: 'boolean', description: 'Issue a new one, retiring the old.' },
  },
  examples: ['locker admin dojos poster', 'locker admin dojos poster --dojo "Dojo Linz" --rotate'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const named = optionalString(input, 'dojo');
    const rotate = input.values['rotate'] === true;
    const dojo = named ? await findDojo(context, named) : null;
    const what = dojo ? `"${dojo.name}"` : 'the installation';

    if (!rotate) {
      const token = dojo ? dojo.eventCodeToken : (await installationRule(context)).eventCodeToken;
      return token
        ? { human: `${context.origin}/e/${token}`, data: { dojo: dojo?.id ?? null, url: `${context.origin}/e/${token}` } }
        : {
          human: `${what} has no poster: its rule does not ask for one.`,
          data: { dojo: dojo?.id ?? null, url: null },
        };
    }

    if (context.dryRun) {
      return { human: `Would issue a new poster for ${what}.`, data: { dryRun: true, dojo: dojo?.id ?? null } };
    }

    await confirm(
      `Issue a new poster for ${what}, so the printed one stops working`,
      context,
      'locker admin dojos poster --rotate',
    );

    const token = dojo
      ? (await asDesk(context, () =>
        context.api.request<EventDetails>(`/api/events/${dojo.id}/event-code`, { method: 'POST' }))).eventCodeToken
      : (await asDesk(context, () =>
        context.api.request<DefaultPolicyDetails>('/api/events/default-policy/event-code', { method: 'POST' }))).eventCodeToken;

    const url = token ? `${context.origin}/e/${token}` : null;
    context.reporter.success(`New poster for ${what}. Print this again.`);
    return { human: url ?? '', data: { dojo: dojo?.id ?? null, url } };
  },
};

const installationRule = (context: Parameters<NonNullable<Command['run']>>[0]) =>
  asDesk(context, () => context.api.request<DefaultPolicyDetails>('/api/events/default-policy'));

async function showInstallationRule(
  context: Parameters<NonNullable<Command['run']>>[0],
): Promise<CommandResult> {
  const rule = await installationRule(context);
  return {
    human: renderPairs(
      [
        ['scope', 'the whole installation'],
        ['in force', ruleLine(rule.policy)],
        ['followed by', `${rule.followingDojos} Dojos`],
        ['overridden by', `${rule.overridingDojos} Dojos`],
        ['loose codes', String(rule.lockersWithoutDojo)],
        ...(rule.eventCodeToken
          ? ([['poster', `${context.origin}/e/${rule.eventCodeToken}`]] as [string, string][])
          : []),
      ],
      context.palette,
    ),
    data: rule,
  };
}

/**
 * The words a person types, and what the API calls them.
 *
 * Hyphenated and lower case on this side, because that is what a flag looks
 * like; the API's spelling is an implementation detail nobody should have to
 * learn to change a rule.
 */
const Modes = {
  none: 'None',
  mentor: 'MentorApproval',
  review: 'ReviewQueue',
  network: 'NetworkMatch',
  poster: 'EventCode',
} as const satisfies Record<string, EventPolicy['uploadApproval']>;

function readMode(raw: string): EventPolicy['uploadApproval'] {
  const mode = Modes[raw.trim().toLowerCase() as keyof typeof Modes];
  if (!mode) {
    throw usageError(
      `"${raw}" is not a mode. Choose ${Object.keys(Modes).join(', ')}.`,
      'locker admin dojos rules --mode mentor',
    );
  }
  return mode;
}

export const adminDojoCommands: Command[] = [
  adminDojosListCommand,
  adminDojosShowCommand,
  adminDojosNewCommand,
  adminDojosRenameCommand,
  adminDojosRemoveCommand,
  adminDojosRulesCommand,
  adminDojosEventCodeCommand,
];

export { orBlank };
