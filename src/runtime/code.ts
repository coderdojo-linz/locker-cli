/**
 * The eight characters printed on the card.
 *
 * The API keeps only letters and digits and upper-cases them, so "k7f2 9qb3",
 * "K7F2-9QB3" and "k7f29qb3" are one code. Doing the same here means a kid who
 * types the spaces they can see on the sticker is not told their code is wrong
 * by a round trip that would have accepted it anyway.
 */
export const normalizeCode = (raw: string): string =>
  Array.from(raw)
    .filter((character) => /[a-z0-9]/i.test(character))
    .join('')
    .toUpperCase();

/** Printed the way it is on the card, in two groups of four. */
export const formatCode = (code: string): string =>
  code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;

/**
 * Shown instead of the code anywhere it is not the point of the command.
 *
 * The last four characters are enough for somebody to recognise their own
 * locker and not enough for a shoulder to read one off a shared screen.
 */
export const maskCode = (code: string): string =>
  code.length <= 4 ? '••••' : `•••• ${code.slice(-4)}`;

/**
 * Checked before the code is spent on a request, so an obvious typo is answered
 * immediately rather than as a 404 that reads like the locker was deleted.
 */
export function codeProblem(code: string): string | null {
  if (code.length === 0) return 'A locker code is empty.';
  if (code.length !== 8) {
    return `A locker code is eight characters. "${formatCode(code)}" has ${code.length}.`;
  }
  return null;
}
