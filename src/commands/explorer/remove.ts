/**
 * explorer remove command - drop a block explorer API key from a profile
 */

import { existsSync } from 'fs';
import chalk from 'chalk';
import type { ExplorerRemoveOptions } from '../../types.js';
import { resolveProfileTarget } from '../../lib/chains.js';
import { EXPLORER_NAMES, isExplorerName } from '../../lib/explorer/index.js';
import {
  getExplorers,
  readProfileDocument,
  removeExplorer,
  writeProfileDocument,
} from '../../lib/profile-file.js';

function fail(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

export async function explorerRemoveCommand(
  name: string,
  options: ExplorerRemoveOptions
): Promise<void> {
  if (!isExplorerName(name)) {
    fail(`Unknown explorer '${name}': known explorers are ${EXPLORER_NAMES.join(', ')}`);
  }

  const { name: profileName, path: profilePath } = await resolveProfileTarget(options.profile);
  if (!existsSync(profilePath)) {
    fail(`Profile not found: ${profilePath}`);
  }

  const doc = await readProfileDocument(profilePath);
  const configured = Object.keys(getExplorers(doc));
  if (!removeExplorer(doc, name)) {
    fail(
      `Explorer '${name}' is not configured in ${profilePath} (configured: ${configured.join(', ') || 'none'})`
    );
  }
  await writeProfileDocument(profilePath, doc);

  if (options.json) {
    console.log(
      JSON.stringify({ profile: profileName, path: profilePath, removed: name }, null, 2)
    );
    return;
  }

  console.log(`Removed ${chalk.bold(name)} from ${chalk.dim(profilePath)}`);
}
