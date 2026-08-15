import type {
  GuestInviteDetails, MentorDetails, SettingsDetails,
} from '../api/types.js';
import { numberOption, optionalString, requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { asDesk, orBlank, requireDeskKey, yesNo } from '../domain/desk.js';
import { findDojo } from '../domain/dojos.js';
import { usageError } from '../runtime/exit.js';
import { formatDate, shortId } from '../runtime/format.js';
import { confirm } from '../runtime/prompt.js';
import { renderPairs, renderTable } from '../runtime/style.js';

/**
 * Who may get in, and what the installation runs under.
 *
 * Every command here needs an admin key. Letting somebody into the desk is an
 * administrator's decision whatever else a mentor may do, and the limits are the
 * installation's rather than any one Dojo's — a mentor key is refused, with the
 * refusal naming `locker auth status` so it is clear which credential is short.
 */

/**
 * Letting somebody help this afternoon.
 *
 * A guest is a parent who came along or a student on their first Saturday. An
 * account is out of proportion to one afternoon and forgetting to remove it
 * afterwards is what actually happens, so an invite carries its own end.
 */
export const adminGuestsListCommand: Command = {
  path: ['admin', 'guests', 'list'],
  summary: 'Guest invites that are still open',
  usage: 'locker admin guests list [--all]',
  options: { all: { type: 'boolean', description: 'Include spent and revoked ones.' } },
  examples: ['locker admin guests list'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const invites = await asDesk(context, () =>
      context.api.request<GuestInviteDetails[]>('/api/guest-invites'));
    const shown = input.values['all'] === true ? invites : invites.filter((invite) => invite.open);

    if (shown.length === 0) return { human: 'No open guest invites.', data: [] };

    return {
      human: renderTable(
        [
          { header: 'id', max: 10 },
          { header: 'label', max: 28 },
          { header: 'dojo', max: 22 },
          { header: 'uses', align: 'right' },
          { header: 'open' },
          { header: 'until' },
        ],
        shown.map((invite) => [
          shortId(invite.id),
          invite.label,
          orBlank(invite.eventName) || 'every Dojo',
          `${invite.useCount}${invite.multiUse ? '' : '/1'}`,
          yesNo(invite.open),
          formatDate(invite.expiresAt),
        ]),
        context.palette,
      ),
      data: shown,
    };
  },
};

export const adminGuestsInviteCommand: Command = {
  path: ['admin', 'guests', 'invite'],
  summary: 'Make a guest invite',
  description: 'Prints the address to send, or to hold up as a QR at the door.',
  usage: 'locker admin guests invite <label> [--dojo <dojo>] [--hours <n>] [--single-use]',
  options: {
    dojo: { type: 'string', description: 'Confine the guest to one Dojo.', placeholder: '<dojo>' },
    hours: { type: 'string', description: 'How long the invite may be redeemed. Default 24.', placeholder: '<n>' },
    'session-hours': { type: 'string', description: 'How long a guest stays in. Default 8.', placeholder: '<n>' },
    'single-use': { type: 'boolean', description: 'One person only.' },
  },
  examples: [
    'locker admin guests invite "Saturday helpers" --dojo "Dojo Linz"',
    'locker admin guests invite "Marta" --single-use --hours 4',
  ],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const label = requirePositional(input, 0, 'a label', 'locker admin guests invite "Saturday helpers"').trim();
    const namedDojo = optionalString(input, 'dojo');
    const dojo = namedDojo ? await findDojo(context, namedDojo) : null;

    const body = {
      label,
      eventId: dojo?.id ?? null,
      multiUse: input.values['single-use'] !== true,
      maximumUses: null,
      validHours: numberOption(input, 'hours') ?? 24,
      sessionHours: numberOption(input, 'session-hours') ?? 8,
    };

    if (context.dryRun) {
      return {
        human:
          `Would invite "${label}"${dojo ? ` to "${dojo.name}"` : ' to every Dojo'}, ` +
          `redeemable for ${body.validHours}h, ${body.sessionHours}h once in.`,
        data: { dryRun: true, ...body },
      };
    }

    const invite = await asDesk(context, () =>
      context.api.request<GuestInviteDetails>('/api/guest-invites', { method: 'POST', body }));
    context.reporter.success(`Invited "${invite.label}".`);
    // The address is the whole point, so it is the answer rather than a note.
    return { human: invite.url, data: invite };
  },
};

export const adminGuestsRevokeCommand: Command = {
  path: ['admin', 'guests', 'revoke'],
  summary: 'Close a guest invite',
  description: 'Anybody already in stays until their afternoon runs out.',
  usage: 'locker admin guests revoke <invite>',
  examples: ['locker admin guests revoke "Saturday helpers"'],
  destructive: true,
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const reference = requirePositional(input, 0, 'an invite', 'locker admin guests list').trim();
    const invites = await asDesk(context, () =>
      context.api.request<GuestInviteDetails[]>('/api/guest-invites'));
    const wanted = reference.toLowerCase();
    const invite = invites.find((item) =>
      item.id === reference || shortId(item.id) === wanted || item.label.toLowerCase() === wanted);
    if (!invite) {
      throw usageError(`No invite matches "${reference}".`, 'locker admin guests list');
    }

    if (context.dryRun) {
      return {
        human: `Would close the invite "${invite.label}".`,
        data: { dryRun: true, id: invite.id, label: invite.label },
      };
    }

    await asDesk(context, () =>
      context.api.request<void>(`/api/guest-invites/${invite.id}`, { method: 'DELETE' }));
    context.reporter.success(`Closed "${invite.label}". Nobody new can use it.`);
    return { human: '', data: { id: invite.id, label: invite.label, revoked: true } };
  },
};

/**
 * The limits the whole installation runs under. Needs an admin key.
 */
export const adminSettingsCommand: Command = {
  path: ['admin', 'settings'],
  summary: 'Show or change the installation limits',
  description:
    'With no flags this prints them. Any flag changes that one and leaves the\n' +
    'rest alone. Needs an admin key — a mentor key does not reach this.',
  usage: 'locker admin settings [--storage <mb>] [--max-file <mb>] [--max-files <n>] [--keep-days <n>]',
  options: {
    storage: { type: 'string', description: 'Storage a new locker gets, in MB.', placeholder: '<mb>' },
    'max-file': { type: 'string', description: 'Biggest single file, in MB.', placeholder: '<mb>' },
    'max-files': { type: 'string', description: 'Most files in one project.', placeholder: '<n>' },
    'keep-days': { type: 'string', description: 'Delete untouched lockers after this many days. 0 for never.', placeholder: '<n>' },
  },
  examples: ['locker admin settings', 'locker admin settings --max-file 50'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const storage = numberOption(input, 'storage');
    const maxFile = numberOption(input, 'max-file');
    const maxFiles = numberOption(input, 'max-files');
    const keepDays = numberOption(input, 'keep-days');
    const changing = [storage, maxFile, maxFiles, keepDays].some((value) => value !== undefined);

    const current = await asDesk(context, () =>
      context.api.request<SettingsDetails>('/api/settings'));

    if (!changing) {
      return {
        human: renderPairs(
          [
            ['storage per locker', `${current.defaultStorageLimitMb} MB`],
            ['biggest file', `${current.maximumFileSizeMb} MB`],
            ['most files in a project', String(current.maximumFilesPerProject)],
            [
              'delete untouched after',
              current.untouchedLockerRetentionDays
                ? `${current.untouchedLockerRetentionDays} days`
                : 'never',
            ],
          ],
          context.palette,
        ),
        data: current,
      };
    }

    const body = {
      defaultStorageLimitMb: storage ?? current.defaultStorageLimitMb,
      maximumFileSizeMb: maxFile ?? current.maximumFileSizeMb,
      maximumFilesPerProject: maxFiles ?? current.maximumFilesPerProject,
      untouchedLockerRetentionDays:
        keepDays === undefined ? current.untouchedLockerRetentionDays : (keepDays || null),
    };

    if (context.dryRun) {
      return { human: 'Would change the installation limits.', data: { dryRun: true, ...body } };
    }

    const updated = await asDesk(context, () =>
      context.api.request<SettingsDetails>('/api/settings', { method: 'PUT', body }));
    context.reporter.success('Limits saved.');
    return { human: '', data: updated };
  },
};

/**
 * Who can get into the desk. Needs an admin key.
 */
export const adminMentorsListCommand: Command = {
  path: ['admin', 'mentors', 'list'],
  summary: 'Everybody who can get into the desk',
  usage: 'locker admin mentors list',
  examples: ['locker admin mentors list'],
  async run(context): Promise<CommandResult> {
    requireDeskKey(context);
    const mentors = await asDesk(context, () =>
      context.api.request<MentorDetails[]>('/api/mentors'));

    return {
      human: renderTable(
        [
          { header: 'id', max: 10 },
          { header: 'name', max: 26 },
          { header: 'email', max: 32 },
          { header: 'role' },
          { header: 'dojo', max: 20 },
          { header: 'last seen' },
        ],
        mentors.map((mentor) => [
          shortId(mentor.id),
          mentor.name,
          mentor.email,
          mentor.role,
          orBlank(mentor.eventName),
          formatDate(mentor.lastSeenAt),
        ]),
        context.palette,
      ),
      data: mentors,
    };
  },
};

export const adminMentorsAddCommand: Command = {
  path: ['admin', 'mentors', 'add'],
  summary: 'Add somebody to the desk',
  description:
    'The password is a temporary one to hand over; they change it by signing in.\n' +
    'Read from a prompt or standard input, never taken as an argument.',
  usage: 'locker admin mentors add <name> <email> [--role <role>] [--password-stdin]',
  options: {
    role: { type: 'string', description: 'admin, mentor, or scan-and-print. Default mentor.', placeholder: '<role>' },
    'password-stdin': { type: 'boolean', description: 'Read the temporary password from standard input.' },
  },
  examples: ['locker admin mentors add "Marta" marta@dojo.at --role mentor'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const usage = 'locker admin mentors add "Marta" marta@dojo.at';
    const name = requirePositional(input, 0, 'a name', usage).trim();
    const email = requirePositional(input, 1, 'an email address', usage).trim();
    const role = (optionalString(input, 'role') ?? 'mentor').trim();

    const { askSecret, canPrompt, readStdin } = await import('../runtime/prompt.js');
    const password = input.values['password-stdin'] === true
      ? (await readStdin()).trim()
      : canPrompt(context.reporter)
        ? (await askSecret('Temporary password: ')).trim()
        : '';
    if (password.length === 0) {
      throw usageError(
        'A temporary password is needed, and there is nobody here to ask.',
        `${usage} --password-stdin`,
      );
    }

    if (context.dryRun) {
      return {
        human: `Would add ${name} <${email}> as ${role}.`,
        data: { dryRun: true, name, email, role },
      };
    }

    const mentor = await asDesk(context, () =>
      context.api.request<MentorDetails>('/api/mentors', {
        method: 'POST',
        body: { name, email, role, password },
      }));
    context.reporter.success(`Added ${mentor.name} as ${mentor.role}.`);
    return { human: `${shortId(mentor.id)}  ${mentor.name}`, data: mentor };
  },
};

export const adminMentorsRoleCommand: Command = {
  path: ['admin', 'mentors', 'role'],
  summary: "Change somebody's role",
  usage: 'locker admin mentors role <mentor> <role>',
  examples: ['locker admin mentors role marta@dojo.at admin'],
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const usage = 'locker admin mentors role marta@dojo.at admin';
    const mentor = await findMentor(context, requirePositional(input, 0, 'a mentor', usage));
    const role = requirePositional(input, 1, 'a role', usage).trim();

    if (context.dryRun) {
      return {
        human: `Would make ${mentor.name} a ${role} (was ${mentor.role}).`,
        data: { dryRun: true, id: mentor.id, from: mentor.role, to: role },
      };
    }

    const updated = await asDesk(context, () =>
      context.api.request<MentorDetails>(`/api/mentors/${mentor.id}`, {
        method: 'PUT',
        body: { name: mentor.name, email: mentor.email, role, password: null },
      }));
    context.reporter.success(`${updated.name} is now ${updated.role}.`);
    return { human: '', data: updated };
  },
};

export const adminMentorsRemoveCommand: Command = {
  path: ['admin', 'mentors', 'rm'],
  summary: 'Take somebody off the desk',
  usage: 'locker admin mentors rm <mentor>',
  examples: ['locker admin mentors rm marta@dojo.at --dry-run'],
  destructive: true,
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const mentor = await findMentor(
      context,
      requirePositional(input, 0, 'a mentor', 'locker admin mentors list'),
    );

    if (context.dryRun) {
      return {
        human: `Would remove ${mentor.name} <${mentor.email}>.`,
        data: { dryRun: true, id: mentor.id, name: mentor.name },
      };
    }

    await confirm(
      `Remove ${mentor.name} <${mentor.email}> from the desk`,
      context,
      `locker admin mentors rm ${mentor.email}`,
    );
    await asDesk(context, () =>
      context.api.request<void>(`/api/mentors/${mentor.id}`, { method: 'DELETE' }));
    context.reporter.success(`Removed ${mentor.name}.`);
    return { human: '', data: { id: mentor.id, name: mentor.name, deleted: true } };
  },
};

/** By email, which is what a person knows, or by id when two share a name. */
async function findMentor(
  context: Parameters<NonNullable<Command['run']>>[0],
  reference: string,
): Promise<MentorDetails> {
  const wanted = reference.trim().toLowerCase();
  const mentors = await asDesk(context, () =>
    context.api.request<MentorDetails[]>('/api/mentors'));
  const found = mentors.find((mentor) =>
    mentor.id === reference.trim() ||
    shortId(mentor.id) === wanted ||
    mentor.email.toLowerCase() === wanted ||
    mentor.name.toLowerCase() === wanted);
  if (!found) throw usageError(`Nobody here matches "${reference}".`, 'locker admin mentors list');
  return found;
}

export const adminPeopleCommands: Command[] = [
  adminGuestsListCommand,
  adminGuestsInviteCommand,
  adminGuestsRevokeCommand,
  adminSettingsCommand,
  adminMentorsListCommand,
  adminMentorsAddCommand,
  adminMentorsRoleCommand,
  adminMentorsRemoveCommand,
];
