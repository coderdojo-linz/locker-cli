import { truncate } from './format.js';

/**
 * Colour and columns.
 *
 * Every escape sequence in the CLI is applied here, and only after a width has
 * been measured — padding a string that already carries escapes counts the
 * escapes as characters and the column drifts.
 */

// Built rather than typed. A literal escape byte in a source file survives
// neither a careless editor nor a diff viewer intact, and the two dead ANSI
// codes that would leave behind are invisible until somebody sees "[0m" printed.
const ESC = String.fromCharCode(27);

const CODES = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  cyan: `${ESC}[36m`,
} as const;

export type StyleName = keyof Omit<typeof CODES, 'reset'>;

/**
 * Whether escapes are worth emitting at all.
 *
 * NO_COLOR is honoured whatever its value, per the convention: its presence is
 * the signal. A stream that is not a terminal gets none either, so a piped or
 * redirected run stays clean without anybody passing a flag.
 */
export function colorEnabled(
  stream: { isTTY?: boolean },
  flagDisabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (flagDisabled) return false;
  if (env['NO_COLOR'] !== undefined) return false;
  if (env['TERM'] === 'dumb') return false;
  return stream.isTTY === true;
}

export class Palette {
  constructor(private readonly enabled: boolean) {}

  paint(value: string, ...styles: StyleName[]): string {
    if (!this.enabled || styles.length === 0) return value;
    return `${styles.map((style) => CODES[style]).join('')}${value}${CODES.reset}`;
  }

  bold = (value: string): string => this.paint(value, 'bold');
  dim = (value: string): string => this.paint(value, 'dim');
  red = (value: string): string => this.paint(value, 'red');
  green = (value: string): string => this.paint(value, 'green');
  yellow = (value: string): string => this.paint(value, 'yellow');
  cyan = (value: string): string => this.paint(value, 'cyan');
}

export interface TableColumn {
  header: string;
  /** Longest this column may get before its cells lose their middles. */
  max?: number;
  align?: 'left' | 'right';
}

/**
 * A list as columns.
 *
 * Widths come from the content so a narrow list stays narrow, and the whole
 * table is bounded by the terminal so a long project name cannot push the last
 * column off the edge. An empty table renders as nothing at all — the caller
 * says "no projects yet" better than a header with no rows under it.
 */
export function renderTable(
  columns: TableColumn[],
  rows: string[][],
  palette: Palette,
  terminalWidth = process.stdout.columns || 100,
): string {
  if (rows.length === 0) return '';

  const gap = 2;
  const budget = Math.max(40, terminalWidth - 1);
  const widths = columns.map((column, index) => {
    const longest = rows.reduce(
      (width, row) => Math.max(width, (row[index] ?? '').length),
      column.header.length,
    );
    return Math.min(longest, column.max ?? longest);
  });

  // Shrink from the widest column inwards rather than the last one: the last
  // column is usually a date, and a date that loses characters is unreadable
  // while a name that loses its middle is still recognisable.
  let total = widths.reduce((sum, width) => sum + width, 0) + gap * (columns.length - 1);
  while (total > budget) {
    const widest = widths.indexOf(Math.max(...widths));
    if ((widths[widest] ?? 0) <= 8) break;
    widths[widest] = (widths[widest] ?? 0) - 1;
    total -= 1;
  }

  // Padded, then trimmed at the end of the line, so copying a row out of a
  // terminal does not carry invisible trailing spaces with it.
  const line = (cells: string[], style: (value: string) => string): string =>
    cells
      .map((cell, index) => {
        const width = widths[index] ?? 0;
        const clipped = truncate(cell, width);
        return style(
          columns[index]?.align === 'right' ? clipped.padStart(width) : clipped.padEnd(width),
        );
      })
      .join(' '.repeat(gap))
      .trimEnd();

  return [
    line(
      columns.map((column) => column.header.toUpperCase()),
      (value) => palette.dim(value),
    ),
    ...rows.map((row) =>
      line(
        columns.map((_, index) => row[index] ?? ''),
        (value) => value,
      ),
    ),
  ].join('\n');
}

/** A two-column block for one object, where a table of one row would read worse. */
export function renderPairs(pairs: [string, string][], palette: Palette): string {
  const width = pairs.reduce((longest, [label]) => Math.max(longest, label.length), 0);
  return pairs
    .map(([label, value]) => `${palette.dim(`${label}:`.padEnd(width + 1))} ${value}`)
    .join('\n');
}
