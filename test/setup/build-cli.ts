/**
 * Global setup for the layers that run the published binary: make sure
 * `dist/index.js` is the current source.
 *
 * The build is skipped when the output is already newer than every input, so a
 * repeat run costs a directory walk rather than a full `tsc`. Both child-process
 * projects declare this file, and Vitest runs a global setup once per project,
 * which the staleness check turns into one build rather than two.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_ENTRY = join(REPO_ROOT, 'dist', 'index.js');

function newestMtime(path: string): number {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) {
    return Number.POSITIVE_INFINITY;
  }
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }
  let newest = stats.mtimeMs;
  for (const entry of readdirSync(path)) {
    newest = Math.max(newest, newestMtime(join(path, entry)));
  }
  return newest;
}

export function setup(): void {
  const builtAt = statSync(CLI_ENTRY, { throwIfNoEntry: false })?.mtimeMs ?? 0;
  const sources = ['index.ts', 'src', 'tsconfig.json', 'package.json'].map((entry) =>
    newestMtime(join(REPO_ROOT, entry))
  );

  if (builtAt > Math.max(...sources)) {
    return;
  }

  execFileSync(process.execPath, [join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}
