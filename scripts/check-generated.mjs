import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Fails when src/api/schema.ts is not what the committed document produces.
 *
 * The generated file is committed because publishing this package must not need
 * the .NET SDK — but a committed generated file drifts the first time somebody
 * regenerates openapi.json and forgets this half. Regenerating into a temporary
 * directory and comparing is the cheapest way to notice.
 *
 * Run through the generator's own entry point rather than its library API: the
 * command line writes a banner the library does not, so comparing the two would
 * report a difference on every run. And by `node <path>` rather than by npx,
 * because a .cmd shim cannot be spawned without a shell on Windows.
 */

const committed = 'src/api/schema.ts';
const document = '../CoderDojoCloud.Api/openapi.json';
const generator = 'node_modules/openapi-typescript/bin/cli.js';

const scratch = mkdtempSync(join(tmpdir(), 'locker-schema-'));
const fresh = join(scratch, 'schema.ts');

try {
  execFileSync(process.execPath, [generator, document, '-o', fresh], { stdio: 'inherit' });

  // Written by the same generator on both sides, so only the line endings a
  // checkout may have changed are worth normalising.
  const text = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trimEnd();

  if (text(committed) === text(fresh)) {
    console.log(`${committed} is current.`);
    process.exit(0);
  }

  console.error(`${committed} is out of date. Run "npm run generate" and commit the result.`);
  process.exit(1);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
