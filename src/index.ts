#!/usr/bin/env node
import { createRequire } from 'node:module';
import { parseCommandLine } from './runtime/args.js';
import { COMMANDS } from './commands/registry.js';
import { createContext } from './runtime/context.js';
import { Diagnostics } from './runtime/diagnostics.js';
import { CliError, Exit, usageError, type ExitCode } from './runtime/exit.js';
import { isBranch, renderBranchHelp, renderCommandHelp, renderRootHelp } from './runtime/help.js';
import { Reporter } from './runtime/reporter.js';
import { Palette, colorEnabled } from './runtime/style.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

/**
 * The whole run, in the order the pieces have to happen.
 *
 * Output mode is settled before anything else, because it decides whether a
 * question may be asked; the command is found before the flags are parsed,
 * because a command's own options are part of what is legal to pass. Nothing
 * writes to stdout except the reporter at the very end.
 */
async function main(argv: string[]): Promise<ExitCode> {
  // Enough of a reporter to explain a failure that happens before there is a
  // real one — a bad flag, an unusable host.
  const fallbackPalette = new Palette(colorEnabled(process.stdout, argv.includes('--no-color')));
  let reporter = new Reporter('human', false, fallbackPalette, 0);
  let diagnostics = new Diagnostics();

  try {
    const parsed = parseCommandLine(argv, COMMANDS);

    if (parsed.wantsVersion) {
      process.stdout.write(`${version}\n`);
      return Exit.Ok;
    }

    // Help never needs a network, a code, or a valid host, so it is answered
    // before any of that is resolved. `--help` always exits 0.
    if (parsed.wantsHelp) {
      process.stdout.write(`${helpFor(parsed.command, argv, fallbackPalette)}\n`);
      return Exit.Ok;
    }

    if (!parsed.command) {
      const word = argv.find((argument) => !argument.startsWith('-'));
      if (!word) {
        // Bare `locker`. Somebody asking what this is, so answer on stdout.
        process.stdout.write(`${renderRootHelp(fallbackPalette, version)}\n`);
        return Exit.Ok;
      }
      if (isBranch(word)) {
        // A branch with no verb is an unfinished command, not a question, so
        // the page goes to stderr and the exit code says it did not run.
        process.stderr.write(`${renderBranchHelp(word, fallbackPalette)}\n`);
        return Exit.Usage;
      }
      throw usageError(`There is no "${word}" command.`, 'locker --help');
    }

    const context = createContext(parsed.flags);
    reporter = context.reporter;
    diagnostics = context.diagnostics;

    const result = await parsed.command.run(context, parsed.input);
    reporter.emit(result.human, result.data);
    return Exit.Ok;
  } catch (error) {
    return report(error, argv, reporter, diagnostics);
  }
}

function helpFor(command: ReturnType<typeof parseCommandLine>['command'], argv: string[], palette: Palette): string {
  if (command) return renderCommandHelp(command, palette);
  const word = argv.find((argument) => !argument.startsWith('-'));
  if (word && isBranch(word)) return renderBranchHelp(word, palette);
  return renderRootHelp(palette, version);
}

/**
 * Turns whatever went wrong into a message, an exit code, and — for the ones
 * nobody predicted — a file worth attaching to a bug report.
 *
 * A CliError is a failure the CLI understands, so it is reported as itself.
 * Anything else is a bug: it gets a diagnostic file and says so, rather than
 * being dressed up as an expected outcome.
 */
function report(
  error: unknown,
  argv: string[],
  reporter: Reporter,
  diagnostics: Diagnostics,
): ExitCode {
  if (error instanceof CliError) {
    // Expected failures do not write a file unless somebody asked for detail;
    // a wrong locker code should not litter the disk.
    const log = reporter.verbosity > 0 ? diagnostics.write(error, argv) : undefined;
    reporter.emitError(error, log);
    return error.exitCode;
  }

  const log = diagnostics.write(error, argv);
  const unexpected = new CliError(
    error instanceof Error ? error.message : String(error),
    {
      kind: 'failure',
      exitCode: Exit.Failure,
      recovery: 'This looks like a bug in the CLI. Please report it.',
    },
  );
  reporter.emitError(unexpected, log);
  return Exit.Failure;
}

// process.exitCode rather than process.exit, so buffered stdout is flushed
// before the process ends. A piped `--json` can otherwise lose its last chunk.
process.exitCode = await main(process.argv.slice(2));
