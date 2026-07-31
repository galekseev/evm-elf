/**
 * chain remove command - drop a chain from a profile
 */

import { existsSync } from 'fs';
import chalk from 'chalk';
import type { ChainRemoveOptions } from '../../types.js';
import { resolveProfileTarget } from '../../lib/chains.js';
import {
  listChains,
  readProfileDocument,
  removeChain,
  writeProfileDocument,
} from '../../lib/profile-file.js';

export async function chainRemoveCommand(
  chain: string,
  options: ChainRemoveOptions
): Promise<void> {
  const { name: profileName, path: profilePath } = await resolveProfileTarget(options.profile);
  if (!existsSync(profilePath)) {
    console.error(chalk.red(`Profile not found: ${profilePath}`));
    process.exit(1);
  }

  const doc = await readProfileDocument(profilePath);
  if (!removeChain(doc, chain)) {
    console.error(
      chalk.red(
        `Chain '${chain}' is not in ${profilePath} (configured: ${listChains(doc).join(', ') || 'none'})`
      )
    );
    process.exit(1);
  }
  await writeProfileDocument(profilePath, doc);

  if (options.json) {
    console.log(JSON.stringify({ profile: profileName, path: profilePath, removed: chain }, null, 2));
    return;
  }
  console.log(`Removed ${chalk.bold(chain)} from ${chalk.dim(profilePath)}`);
}
