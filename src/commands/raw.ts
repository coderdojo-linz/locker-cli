import { optionalString, requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { usageError } from '../runtime/exit.js';

const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']);

/**
 * The escape hatch.
 *
 * Every CLI over an API eventually meets an endpoint it does not wrap, and
 * without this the only options are waiting for a release or reaching for curl
 * and reassembling the host by hand. It is marked expert and kept out of the
 * common-tasks list: it is here to be found when needed, not to be the way
 * anything normal gets done.
 *
 * `{code}` in the path is filled in, because typing a credential into a URL by
 * hand is how it ends up in shell history.
 */
export const rawCommand: Command = {
  path: ['raw'],
  summary: 'Call an endpoint this CLI does not wrap',
  description:
    'For endpoints with no command of their own. "{code}" in the path becomes the locker code.\n' +
    'Output is whatever the server sent, so --json here means "the server said JSON".\n\n' +
    'Write the path without a leading slash. Some shells — Git Bash on Windows —\n' +
    'rewrite "/api/..." into a file path before the CLI ever sees it.',
  usage: 'locker raw <method> <path> [--body <json>]',
  expert: true,
  options: {
    body: {
      type: 'string',
      description: 'A JSON request body.',
      placeholder: '<json>',
    },
  },
  examples: [
    'locker raw GET api/lockers/{code}',
    'locker raw GET api/lockers/{code}/shares',
    'locker raw PUT api/lockers/{code} --body \'{"name":"Blue Otter","ownerName":null}\'',
  ],
  async run(context, input): Promise<CommandResult> {
    const method = requirePositional(input, 0, 'a method', 'locker raw GET /api/lockers/{code}')
      .trim()
      .toUpperCase();
    if (!METHODS.has(method)) {
      throw usageError(`"${method}" is not a method. Use one of: ${[...METHODS].join(', ')}.`);
    }

    const rawPath = requirePositional(input, 1, 'a path', 'locker raw GET /api/lockers/{code}');
    const path = rawPath.includes('{code}')
      ? rawPath.replaceAll('{code}', encodeURIComponent(context.requireCode()))
      : rawPath;

    const bodyText = optionalString(input, 'body');
    let body: unknown;
    if (bodyText !== undefined) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        throw usageError('--body has to be valid JSON.');
      }
    }

    if (context.dryRun) {
      return {
        human: `Would send ${method} ${context.origin}${path}`,
        data: { dryRun: true, method, url: `${context.origin}${path}`, body: body ?? null },
      };
    }

    const result = await context.api.request<unknown>(path, {
      method,
      ...(body === undefined ? {} : { body }),
      // No opinion about what a 404 means here: the caller chose the path, so
      // only they know whether a missing thing is the code or the resource.
      notFound: { kind: 'resource', message: `${method} ${path} found nothing.` },
    });

    return {
      human: result === undefined ? '(no content)' : JSON.stringify(result, null, 2),
      data: result ?? null,
    };
  },
};
