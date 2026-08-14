import type { Command, CommandResult } from '../runtime/command.js';
import { CONFIG_KEYS, readConfig } from '../runtime/config.js';
import { DEFAULT_HOST, DEFAULT_LANGUAGE } from '../runtime/context.js';
import { configFile, credentialsFile } from '../runtime/paths.js';
import { renderPairs, renderTable } from '../runtime/style.js';

/**
 * What is saved, and what is winning.
 *
 * Shows the stored value beside the one actually in force, because the whole
 * point of a precedence order is that they can differ — and a person looking at
 * this is usually trying to work out why.
 *
 * The locker code is never shown here whatever is asked. It lives in a different
 * file for that reason; `auth status --show-code` is the one place it appears.
 */
export const configShowCommand: Command = {
  path: ['config', 'get'],
  summary: 'Show the saved settings and which are in force',
  usage: 'locker config get',
  examples: ['locker config get', 'locker config get --json'],
  async run(context): Promise<CommandResult> {
    const stored = readConfig();
    const effective: Record<string, string> = {
      host: context.origin,
      output: context.reporter.mode,
      lang: context.language,
    };
    const defaults: Record<string, string> = {
      host: DEFAULT_HOST,
      output: 'human',
      lang: DEFAULT_LANGUAGE,
    };

    const rows = CONFIG_KEYS.map((key) => [
      key,
      stored[key] ?? context.palette.dim('(not set)'),
      effective[key] ?? '',
      stored[key] === undefined && effective[key] === defaults[key]
        ? context.palette.dim('default')
        : '',
    ]);

    return {
      human: [
        renderTable(
          [{ header: 'key' }, { header: 'saved' }, { header: 'in force' }, { header: '' }],
          rows,
          context.palette,
        ),
        '',
        renderPairs(
          [
            ['config', configFile()],
            ['credentials', credentialsFile()],
          ],
          context.palette,
        ),
      ].join('\n'),
      data: {
        stored,
        effective,
        files: { config: configFile(), credentials: credentialsFile() },
      },
    };
  },
};
