import type { Command } from '../runtime/command.js';
import { authLoginCommand } from './authLogin.js';
import { authLogoutCommand } from './authLogout.js';
import { authStatusCommand, whoamiCommand } from './authStatus.js';
import { configClearCommand } from './configClear.js';
import { configPathCommand } from './configPath.js';
import { configSetCommand } from './configSet.js';
import { configShowCommand } from './configShow.js';
import { downloadCommand } from './download.js';
import { filesDeleteCommand } from './filesDelete.js';
import { filesListCommand } from './filesList.js';
import { filesRenameCommand } from './filesRename.js';
import { filesReplaceCommand } from './filesReplace.js';
import { projectsDeleteCommand } from './projectsDelete.js';
import { projectsListCommand } from './projectsList.js';
import { projectsRenameCommand } from './projectsRename.js';
import { projectsShowCommand } from './projectsShow.js';
import { rawCommand } from './raw.js';
import { shareCreateCommand } from './shareCreate.js';
import { shareListCommand } from './shareList.js';
import { shareRevokeCommand } from './shareRevoke.js';
import { statusCommand } from './status.js';
import { uploadCommand } from './upload.js';

/**
 * Every command, in the order help should show them.
 *
 * Grouped by what a person is trying to do rather than by which endpoint is
 * behind it: the three things a child actually does — put work in, take work
 * out, see what is there — sit at the top level, and everything below is
 * tidying up, grouped by the thing being tidied.
 */
export const COMMANDS: Command[] = [
  uploadCommand,
  downloadCommand,
  statusCommand,
  whoamiCommand,

  authLoginCommand,
  authLogoutCommand,
  authStatusCommand,

  projectsListCommand,
  projectsShowCommand,
  projectsRenameCommand,
  projectsDeleteCommand,

  filesListCommand,
  filesRenameCommand,
  filesReplaceCommand,
  filesDeleteCommand,

  shareCreateCommand,
  shareListCommand,
  shareRevokeCommand,

  configPathCommand,
  configShowCommand,
  configSetCommand,
  configClearCommand,

  rawCommand,
];

/** The commands shown under COMMON TASKS, which is what a first-time reader needs. */
export const COMMON_TASKS: { command: string; blurb: string }[] = [
  { command: 'locker auth login', blurb: 'Enter the code from your card' },
  { command: 'locker status', blurb: 'See what is in your locker' },
  { command: 'locker upload ./my-project', blurb: 'Save work into a new project' },
  { command: 'locker download <project>', blurb: 'Get work back out' },
];

/** The branches, in the order help lists them. */
export const BRANCHES = ['auth', 'projects', 'files', 'share', 'config'] as const;

export const branchOf = (command: Command): string | null =>
  command.path.length > 1 ? (command.path[0] as string) : null;
