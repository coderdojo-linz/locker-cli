import type { Command, CommandResult } from '../runtime/command.js';
import { CONFIG_KEYS, isConfigKey, readConfig, writeConfig } from '../runtime/config.js';
import { usageError } from '../runtime/exit.js';
import { confirm } from '../runtime/prompt.js';

/**
 * Puts settings back to their defaults.
 *
 * Only settings. The saved locker code is deliberately out of reach here — it
 * lives in a different file and is removed by `auth logout`, so that clearing
 * preferences can never be the thing that signs somebody out by surprise.
 */
export const configClearCommand: Command = {
  path: ['config', 'clear'],
  summary: 'Remove a saved setting, or all of them',
  description: 'Does not touch the saved locker code. Use "locker auth logout" for that.',
  usage: 'locker config clear [key] [--yes]',
  destructive: true,
  examples: ['locker config clear host', 'locker config clear --dry-run', 'locker config clear --yes'],
  async run(context, input): Promise<CommandResult> {
    const key = input.positionals[0];
    const stored = readConfig();

    if (key !== undefined && !isConfigKey(key)) {
      throw usageError(`"${key}" is not a setting. Keys are: ${CONFIG_KEYS.join(', ')}.`, 'locker config get');
    }

    const targets = key ? [key] : CONFIG_KEYS.filter((name) => stored[name] !== undefined);
    if (targets.length === 0) {
      return { human: 'There are no saved settings to remove.', data: { cleared: [] } };
    }

    if (context.dryRun) {
      return {
        human: `Would remove: ${targets.join(', ')}.`,
        data: { dryRun: true, cleared: targets },
      };
    }

    await confirm(
      key ? `Remove the saved ${key}` : `Remove all ${targets.length} saved settings`,
      { reporter: context.reporter, assumeYes: context.assumeYes },
      key ? `locker config clear ${key}` : 'locker config clear',
    );

    writeConfig(Object.fromEntries(targets.map((name) => [name, undefined])));
    context.reporter.success(`Removed: ${targets.join(', ')}.`);
    return { human: '', data: { cleared: targets } };
  },
};
