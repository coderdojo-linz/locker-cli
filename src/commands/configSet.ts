import { requirePositional } from '../runtime/args.js';
import type { Command, CommandResult } from '../runtime/command.js';
import { CONFIG_KEYS, isConfigKey, writeConfig } from '../runtime/config.js';
import { normalizeOrigin } from '../runtime/context.js';
import { usageError } from '../runtime/exit.js';

export const configSetCommand: Command = {
  path: ['config', 'set'],
  summary: 'Save a setting so it does not have to be typed',
  description: `Keys: ${CONFIG_KEYS.join(', ')}.\nA locker code is not a setting — use "locker auth login".`,
  usage: 'locker config set <key> <value>',
  examples: [
    'locker config set host locker.coderdojo.net',
    'locker config set lang en',
    'locker config set output json',
  ],
  async run(context, input): Promise<CommandResult> {
    const key = requirePositional(input, 0, 'a key', 'locker config set host <host>').trim();
    const value = requirePositional(input, 1, 'a value', `locker config set ${key} <value>`).trim();

    if (!isConfigKey(key)) {
      // A code is the thing somebody will try to put here, so it gets its own
      // answer rather than being lumped in with a typo.
      const hint =
        key === 'code'
          ? 'A locker code is a credential, not a setting.'
          : `Keys are: ${CONFIG_KEYS.join(', ')}.`;
      throw usageError(`"${key}" is not a setting. ${hint}`, key === 'code' ? 'locker auth login' : 'locker config get');
    }

    const normalized = normalize(key, value);
    if (context.dryRun) {
      return {
        human: `Would set ${key} to ${normalized}.`,
        data: { dryRun: true, key, value: normalized },
      };
    }

    const saved = writeConfig({ [key]: normalized });
    context.reporter.success(`${key} is now ${normalized}.`);
    return { human: '', data: saved };
  },
};

/** Validated on the way in, so a bad value fails here rather than on every later command. */
function normalize(key: string, value: string): string {
  if (key === 'host') return normalizeOrigin(value);
  if (key === 'output') {
    if (value !== 'human' && value !== 'json') {
      throw usageError('output is "human" or "json".');
    }
    return value;
  }
  if (key === 'lang') {
    if (value !== 'de' && value !== 'en') throw usageError('lang is "de" or "en".');
    return value;
  }
  return value;
}
