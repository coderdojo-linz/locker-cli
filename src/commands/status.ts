import type { Command, CommandResult } from '../runtime/command.js';
import { formatBytes, formatDate, pluralize, shortId } from '../runtime/format.js';
import { fetchLocker, remainingBytes } from '../domain/locker.js';
import { renderPairs, renderTable } from '../runtime/style.js';

/** How wide the how-full-is-it bar is drawn. */
const BAR_WIDTH = 24;

/**
 * What is in the locker and how much room is left.
 *
 * Distinct from `auth status`, which answers "which locker am I even talking
 * to". This one assumes that is settled and describes the contents.
 */
export const statusCommand: Command = {
  path: ['status'],
  summary: 'What is in the locker and how full it is',
  usage: 'locker status',
  examples: ['locker status', 'locker status --json'],
  async run(context): Promise<CommandResult> {
    const locker = await fetchLocker(context);
    const remaining = remainingBytes(locker);
    const used = locker.storageLimitBytes > 0 ? locker.usedBytes / locker.storageLimitBytes : 0;

    const header = renderPairs(
      [
        ['locker', locker.name],
        ['owner', locker.ownerName ?? '—'],
        ['status', locker.status],
        [
          'space',
          `${bar(used, context.palette.dim)} ${formatBytes(locker.usedBytes)} of ${formatBytes(
            locker.storageLimitBytes,
          )} · ${formatBytes(remaining)} free`,
        ],
        ['projects', String(locker.projects.length)],
      ],
      context.palette,
    );

    const table = renderTable(
      [
        { header: 'id', max: 10 },
        { header: 'project', max: 40 },
        { header: 'files', align: 'right' },
        { header: 'size', align: 'right' },
        { header: 'created' },
      ],
      locker.projects.map((project) => [
        shortId(project.id),
        project.name,
        String(project.files.length),
        formatBytes(project.files.reduce((total, file) => total + file.size, 0)),
        formatDate(project.createdAt),
      ]),
      context.palette,
    );

    const body =
      locker.projects.length === 0
        ? context.palette.dim('Nothing in here yet. Try: locker upload ./my-project')
        : table;

    return {
      human: `${header}\n\n${body}`,
      data: {
        ...locker,
        remainingBytes: remaining,
        projectCount: locker.projects.length,
      },
    };
  },
};

/**
 * A bar rather than a percentage.
 *
 * "83%" needs reading; a bar that is nearly full is understood at a glance,
 * which is the whole question a child has before they try to upload something.
 */
function bar(fraction: number, dim: (value: string) => string): string {
  // A locker holding anything at all shows at least one block, so "not empty"
  // never renders as identical to "empty".
  const exact = fraction * BAR_WIDTH;
  const filled = Math.min(BAR_WIDTH, exact > 0 ? Math.max(1, Math.round(exact)) : 0);
  return `${'#'.repeat(filled)}${dim('.'.repeat(BAR_WIDTH - filled))}`;
}
