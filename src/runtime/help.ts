import { GLOBAL_OPTIONS, type Command, type OptionSpec } from './command.js';
import { BRANCHES, COMMANDS, COMMON_TASKS, branchOf } from '../commands/registry.js';
import type { Palette } from './style.js';

/**
 * The help pages.
 *
 * Every page answers three questions: what is this for, what do I type first,
 * and which of these can I not undo. The last one is why destructive commands
 * are marked in the listing rather than only in their own page — the moment
 * somebody needs the warning is while they are scanning for a command, not
 * after they have chosen one.
 *
 * Ordering is by usefulness, never alphabetical.
 */

const INDENT = '  ';

const section = (title: string, body: string, palette: Palette): string =>
  body.trim().length === 0 ? '' : `${palette.bold(title)}\n${body}\n`;

const describeOption = (name: string, spec: OptionSpec): string => {
  const short = spec.short ? `-${spec.short}, ` : '    ';
  const value = spec.placeholder ? ` ${spec.placeholder}` : '';
  return `${INDENT}${short}--${name}${value}`;
};

function optionLines(options: Record<string, OptionSpec>, palette: Palette): string {
  const entries = Object.entries(options).filter(([, spec]) => !spec.hidden);
  if (entries.length === 0) return '';
  const width = Math.max(...entries.map(([name, spec]) => describeOption(name, spec).length));
  return entries
    .map(([name, spec]) => `${describeOption(name, spec).padEnd(width + 2)}${palette.dim(spec.description)}`)
    .join('\n');
}

function commandLines(commands: Command[], palette: Palette, prefixLength: number): string {
  if (commands.length === 0) return '';
  const label = (command: Command): string => command.path.slice(prefixLength).join(' ');
  const width = Math.max(...commands.map((command) => label(command).length));
  return commands
    .map((command) => {
      const marked = command.destructive ? palette.yellow(' [cannot be undone]') : '';
      return `${INDENT}${label(command).padEnd(width + 2)}${palette.dim(command.summary)}${marked}`;
    })
    .join('\n');
}

/** The page shown by `locker` on its own and by `locker --help`. */
export function renderRootHelp(palette: Palette, version: string): string {
  const topLevel = COMMANDS.filter((command) => command.path.length === 1 && !command.expert);
  const expert = COMMANDS.filter((command) => command.expert);

  const tasksWidth = Math.max(...COMMON_TASKS.map((task) => task.command.length));
  const tasks = COMMON_TASKS.map(
    (task) => `${INDENT}${task.command.padEnd(tasksWidth + 2)}${palette.dim(task.blurb)}`,
  ).join('\n');

  const branches = BRANCHES.map((branch) => {
    const members = COMMANDS.filter((command) => branchOf(command) === branch);
    const verbs = members.map((command) => command.path.slice(1).join(' ')).join(', ');
    return `${INDENT}${branch.padEnd(10)}${palette.dim(verbs)}`;
  }).join('\n');

  return [
    section('NAME', `${INDENT}locker — your CoderDojo Locker, from the command line (v${version})`, palette),
    section('USAGE', `${INDENT}locker <command> [options]`, palette),
    section(
      'DESCRIPTION',
      `${INDENT}The code on your card is how you get in. Nothing else to sign up for.`,
      palette,
    ),
    section('COMMON TASKS', tasks, palette),
    section('COMMANDS', commandLines(topLevel, palette, 0), palette),
    section('MORE', branches, palette),
    section(
      'EXPERT',
      commandLines(expert, palette, 0),
      palette,
    ),
    section('OPTIONS', optionLines(GLOBAL_OPTIONS, palette), palette),
    section(
      'ENVIRONMENT',
      [
        `${INDENT}LOCKER_CODE     the locker code, used before anything saved`,
        `${INDENT}LOCKER_HOST     the server to talk to`,
        `${INDENT}LOCKER_OUTPUT   human or json`,
        `${INDENT}LOCKER_LANG     de or en`,
        `${INDENT}LOCKER_CONFIG   where settings are kept`,
        `${INDENT}NO_COLOR        set to turn colour off`,
      ].join('\n'),
      palette,
    ),
    section(
      'EXAMPLES',
      [
        `${INDENT}locker auth login`,
        `${INDENT}locker projects create "Snake"`,
        `${INDENT}locker upload ./my-game --project Snake --dry-run`,
        `${INDENT}locker upload ./my-game --project Snake`,
        `${INDENT}locker download Snake --out ~/projects`,
        `${INDENT}LOCKER_CODE=K7F29QB3 locker status --json`,
      ].join('\n'),
      palette,
    ),
    section('SEE ALSO', `${INDENT}locker <command> --help`, palette),
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

/** The page for `locker projects --help` and its siblings. */
export function renderBranchHelp(branch: string, palette: Palette): string {
  const members = COMMANDS.filter((command) => branchOf(command) === branch);
  const destructive = members.filter((command) => command.destructive);

  return [
    section('NAME', `${INDENT}locker ${branch}`, palette),
    section('USAGE', `${INDENT}locker ${branch} <command> [options]`, palette),
    section('COMMANDS', commandLines(members, palette, 1), palette),
    destructive.length > 0
      ? section(
          'CAREFUL',
          destructive
            .map(
              (command) =>
                `${INDENT}${command.path.join(' ')} cannot be undone. Try --dry-run first.`,
            )
            .join('\n'),
          palette,
        )
      : '',
    section('SEE ALSO', `${INDENT}locker ${branch} <command> --help`, palette),
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

/** The page for one command. */
export function renderCommandHelp(command: Command, palette: Palette): string {
  const name = ['locker', ...command.path].join(' ');
  const description = command.description
    ? command.description
        .split('\n')
        .map((line) => `${INDENT}${line}`)
        .join('\n')
    : `${INDENT}${command.summary}`;

  return [
    section(
      'NAME',
      `${INDENT}${name} — ${command.summary}${command.destructive ? palette.yellow('  [cannot be undone]') : ''}`,
      palette,
    ),
    section('USAGE', `${INDENT}${command.usage}`, palette),
    section('DESCRIPTION', description, palette),
    section('OPTIONS', optionLines(command.options ?? {}, palette), palette),
    section(
      'GLOBAL OPTIONS',
      `${INDENT}${palette.dim('locker --help lists the options every command understands.')}`,
      palette,
    ),
    section(
      'EXAMPLES',
      (command.examples ?? []).map((example) => `${INDENT}${example}`).join('\n'),
      palette,
    ),
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

export const isBranch = (word: string): boolean =>
  (BRANCHES as readonly string[]).includes(word);
