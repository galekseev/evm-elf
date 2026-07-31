/**
 * profile clone command - copy a profile under a new name
 */

import chalk from 'chalk';
import type { ProfileCloneOptions } from '../../types.js';
import { loadProfile, resolveProfilePath } from '../../lib/chains.js';
import { assertProfileName, copyProfile } from '../../lib/profiles.js';

export async function profileCloneCommand(
  source: string,
  name: string,
  options: ProfileCloneOptions
): Promise<void> {
  assertProfileName(name);
  const sourcePath = resolveProfilePath(source);
  const path = resolveProfilePath(name);
  await copyProfile(sourcePath, path, Boolean(options.force));

  const chains = Object.keys((await loadProfile(path)).chains);
  if (options.json) {
    console.log(JSON.stringify({ profile: name, path, source: sourcePath, chains }, null, 2));
    return;
  }

  console.log(`Cloned ${chalk.bold(source)} to ${chalk.bold(name)} ${chalk.dim(path)}`);
  console.log(chalk.dim(`  ${chains.length} chains: ${chains.join(', ') || 'none'}`));
}
