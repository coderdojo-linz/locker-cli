import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the compiled tests, on every Node the package claims to support.
 *
 * `node --test "dist/**\/*.test.js"` would be the obvious thing, and it works
 * on Node 22 and later — the test runner only learned to expand glob patterns
 * there. On Node 20 it looks for a directory with an asterisk in its name and
 * fails, which made the package's own floor untestable.
 *
 * Handing `node --test` a plain directory is not the answer either: it treats
 * every file under it as a test, so the CLI's entry point gets executed and
 * prints its help instead of running anything.
 *
 * So the files are collected here and passed explicitly. No dependency, no
 * shell globbing, and the same behaviour on Windows as on Linux.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function collect(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect(full);
    return entry.isFile() && entry.name.endsWith('.test.js') ? [full] : [];
  });
}

const tests = collect(root).sort();
if (tests.length === 0) {
  console.error(`No compiled tests under ${root}. Run the build first.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
process.exit(result.status ?? 1);
