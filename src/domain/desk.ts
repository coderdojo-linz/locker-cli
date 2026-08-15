import type { Context } from '../runtime/context.js';
import { CliError, Exit } from '../runtime/exit.js';

/**
 * What the desk commands have in common, which is mostly the credential.
 *
 * These act as somebody at the desk rather than as the holder of one locker, so
 * they carry an API key instead of a locker code. Everything else — the
 * transport, how a failing status is read, the diagnostics — is the same
 * machinery the child-facing commands use, because it is the same API.
 *
 * A key is minted at the desk under Settings → API keys, and its role decides
 * how far it reaches: a mentor key manages lockers, codes, Dojos, designs,
 * approvals and links; an admin key adds the installation's settings and its
 * mentor accounts. No key of any role can manage keys, which is what makes
 * revoking one final — so there is deliberately no `locker admin keys` here.
 */

/**
 * Refuses early, and says which command would fix it.
 *
 * Without this the first request goes out unauthenticated and comes back a 401
 * whose message is about the API rather than about what the reader forgot.
 */
export function requireDeskKey(context: Context): string {
  return context.requireKey();
}

/**
 * Turns the API's "you are not allowed" into "your key is not allowed", which is
 * the useful half.
 *
 * A 403 here is nearly always a mentor key asking for something only an admin
 * key reaches, and the API cannot say that: it does not know a CLI is calling,
 * or that the caller has a second key in a drawer.
 */
export async function asDesk<T>(context: Context, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CliError && error.kind === 'not-authorized') {
      throw new CliError(
        `${error.message} This key does not reach that far.`,
        {
          kind: 'not-authorized',
          exitCode: Exit.NotAuthorized,
          recovery: 'locker auth status   (to see what this key reaches)',
          cause: error,
        },
      );
    }
    throw error;
  }
}

/** A yes/no answer printed the same way wherever the desk asks one. */
export const yesNo = (value: boolean): string => value ? 'yes' : 'no';

/** An empty cell reads better than the word "null" in a table of real things. */
export const orBlank = (value: string | null | undefined): string => value ?? '';
