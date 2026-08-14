import type { SharedLinkDetails } from '../api/types.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { formatDate } from '../runtime/format.js';
import { renderTable } from '../runtime/style.js';

/**
 * Which of this locker's work is currently out in the open.
 *
 * Worth having as its own command rather than a column on a project listing: the
 * question "what have I shared" is asked when somebody wants to stop sharing
 * something, and hunting for it project by project is exactly the friction that
 * leaves a link live longer than intended.
 */
export const shareListCommand: Command = {
  path: ['share', 'list'],
  summary: 'List the public links from this locker',
  usage: 'locker share list',
  examples: ['locker share list', 'locker share list --json'],
  async run(context): Promise<CommandResult> {
    const code = context.requireCode();
    const shares = await context.api.request<SharedLinkDetails[]>(
      `/api/lockers/${encodeURIComponent(code)}/shares`,
      { notFound: { kind: 'credential' } },
    );

    if (!shares || shares.length === 0) {
      return { human: 'Nothing from this locker is shared.', data: [] };
    }

    return {
      human: renderTable(
        [
          { header: 'link', max: 44 },
          { header: 'project', max: 30 },
          { header: 'file', max: 30 },
          { header: 'lapses' },
        ],
        shares.map((share) => [
          `${context.origin}/s/${share.code}`,
          share.projectName,
          share.fileName ?? context.palette.dim('whole project'),
          formatDate(share.expiresAt),
        ]),
        context.palette,
      ),
      data: shares.map((share) => ({ ...share, url: `${context.origin}/s/${share.code}` })),
    };
  },
};
