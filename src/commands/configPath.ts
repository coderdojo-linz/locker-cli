import type { Command, CommandResult } from '../runtime/command.js';
import { configDirectory, configFile, credentialsFile, logsDirectory } from '../runtime/paths.js';
import { renderPairs } from '../runtime/style.js';

/**
 * Where the CLI keeps things.
 *
 * Its own command because the answer differs by platform — %APPDATA% on
 * Windows, XDG or ~/.config elsewhere — and "where is my code saved" should not
 * require knowing which convention this machine follows.
 */
export const configPathCommand: Command = {
  path: ['config', 'path'],
  summary: 'Show where settings, credentials and logs are kept',
  usage: 'locker config path',
  examples: ['locker config path'],
  async run(context): Promise<CommandResult> {
    const paths = {
      directory: configDirectory(),
      config: configFile(),
      credentials: credentialsFile(),
      logs: logsDirectory(),
    };

    return {
      human: renderPairs(
        [
          ['directory', paths.directory],
          ['config', paths.config],
          ['credentials', paths.credentials],
          ['logs', paths.logs],
        ],
        context.palette,
      ),
      data: paths,
    };
  },
};
