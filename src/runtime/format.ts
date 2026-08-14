/** Turning numbers and dates into something worth reading in a terminal. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Sizes in the units the rest of the product uses.
 *
 * Powers of 1024 with the short names, matching what the web interface and the
 * API's own refusals say ("25 MB or smaller"). Being pedantically correct with
 * MiB here would mean a limit that reads one way in the browser and another on
 * the command line.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${UNITS[unit]}`;
}

/**
 * Dates in the viewer's own locale and zone.
 *
 * The API speaks UTC ISO throughout; a child reading "14:21" wants their own
 * clock, and a script that needs the exact instant should be reading `--json`,
 * where the original string is passed through untouched.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Long values lose their middle rather than their end, so an extension survives. */
export function truncate(value: string, limit: number): string {
  if (limit <= 1 || value.length <= limit) return value;
  if (limit <= 3) return value.slice(0, limit);
  const head = Math.ceil((limit - 1) / 2);
  const tail = limit - 1 - head;
  return `${value.slice(0, head)}…${tail > 0 ? value.slice(-tail) : ''}`;
}

/** A short id is enough to name a project at a prompt; the full one is in `--json`. */
export const shortId = (id: string): string => id.split('-')[0] ?? id;

export const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;
