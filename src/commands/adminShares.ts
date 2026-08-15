import type { CardDesignDetails, MentorSharedLinkDetails } from '../api/types.js';
import { requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { asDesk, orBlank, requireDeskKey, yesNo } from '../domain/desk.js';
import { findDesign } from '../domain/batches.js';
import { formatDate, shortId } from '../runtime/format.js';
import { confirm } from '../runtime/prompt.js';
import { renderTable } from '../runtime/style.js';

/**
 * What the installation currently has out in the open, and what it prints on.
 *
 * Both reach as far as a mentor key: a mentor is the person a parent asks about
 * a link and the person who notices one that should not be out there, and a
 * design is what a run of codes is printed with.
 */

export const adminSharesListCommand: Command = {
  path: ['admin', 'shares', 'list'],
  summary: 'Every public link the installation currently has open',
  description:
    'A mentor is the person a parent asks about a link, and the person who\n' +
    'notices one that should not be out there.',
  usage: 'locker admin shares list',
  examples: ['locker admin shares list', 'locker admin shares list --json'],
  async run(context): Promise<CommandResult> {
    requireDeskKey(context);
    const links = await asDesk(context, () =>
      context.api.request<MentorSharedLinkDetails[]>('/api/shares'));

    if (links.length === 0) return { human: 'Nothing is shared right now.', data: [] };

    return {
      human: renderTable(
        [
          { header: 'link' },
          { header: 'locker' },
          { header: 'project', max: 26 },
          { header: 'file', max: 22 },
          { header: 'until' },
        ],
        links.map((link) => [
          link.code,
          `${link.lockerCode} ${link.lockerName}`,
          link.projectName,
          orBlank(link.fileName) || context.palette.dim('whole project'),
          formatDate(link.expiresAt),
        ]),
        context.palette,
      ),
      data: links,
    };
  },
};

export const adminSharesRevokeCommand: Command = {
  path: ['admin', 'shares', 'revoke'],
  summary: 'End a public link',
  description: 'The work stays in its locker. Only the address stops opening.',
  usage: 'locker admin shares revoke <link code>',
  examples: ['locker admin shares revoke P9XC2RVB'],
  destructive: true,
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const code = requirePositional(input, 0, 'a link code', 'locker admin shares list').trim();

    if (context.dryRun) {
      return { human: `Would end the link ${code}.`, data: { dryRun: true, code } };
    }

    await asDesk(context, () =>
      context.api.request<void>(`/api/shares/${encodeURIComponent(code)}`, {
        method: 'DELETE',
        notFound: {
          kind: 'resource',
          message: `No open link has the code ${code}.`,
          recovery: 'locker admin shares list',
        },
      }));
    context.reporter.success(`${code} no longer opens anything.`);
    return { human: '', data: { code, revoked: true } };
  },
};

export const adminDesignsListCommand: Command = {
  path: ['admin', 'designs', 'list'],
  summary: 'The card designs',
  description: 'Designs are drawn at the desk; this is for naming one in a print run.',
  usage: 'locker admin designs list',
  examples: ['locker admin designs list'],
  async run(context): Promise<CommandResult> {
    requireDeskKey(context);
    const designs = await asDesk(context, () =>
      context.api.request<CardDesignDetails[]>('/api/card-designs'));

    if (designs.length === 0) {
      context.reporter.note(context.palette.dim(`Draw one at ${context.origin}/desk/cards`));
      return { human: 'No card designs yet.', data: [] };
    }

    return {
      human: renderTable(
        [
          { header: 'id', max: 10 },
          { header: 'design', max: 32 },
          { header: 'size' },
          { header: 'back' },
          { header: 'changed' },
        ],
        designs.map((design) => [
          shortId(design.id),
          design.name,
          `${design.widthMm} × ${design.heightMm} mm`,
          yesNo(Boolean(design.back)),
          formatDate(design.updatedAt),
        ]),
        context.palette,
      ),
      data: designs,
    };
  },
};

export const adminDesignsRemoveCommand: Command = {
  path: ['admin', 'designs', 'rm'],
  summary: 'Delete a card design',
  description:
    'Runs of codes that named it fall back to plain stickers. Nothing already\n' +
    'printed changes, and no locker is touched.',
  usage: 'locker admin designs rm <design>',
  examples: ['locker admin designs rm "Projekt-Locker A5" --dry-run'],
  destructive: true,
  async run(context, input): Promise<CommandResult> {
    requireDeskKey(context);
    const design = await findDesign(
      context,
      requirePositional(input, 0, 'a design', 'locker admin designs list'),
    );

    if (context.dryRun) {
      return {
        human: `Would delete the design "${design.name}".`,
        data: { dryRun: true, id: design.id, name: design.name },
      };
    }

    await confirm(
      `Delete the design "${design.name}"`,
      context,
      `locker admin designs rm ${JSON.stringify(design.name)}`,
    );
    await asDesk(context, () =>
      context.api.request<void>(`/api/card-designs/${design.id}`, { method: 'DELETE' }));
    context.reporter.success(`Deleted "${design.name}".`);
    return { human: '', data: { id: design.id, name: design.name, deleted: true } };
  },
};

export const adminShareCommands: Command[] = [
  adminSharesListCommand,
  adminSharesRevokeCommand,
  adminDesignsListCommand,
  adminDesignsRemoveCommand,
];
