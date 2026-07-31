/**
 * profile create command - a new profile from the bundled one, or an empty one
 */

import chalk from 'chalk';
import type { ProfileCreateOptions } from '../../types.js';
import { loadProfile, resolveProfilePath } from '../../lib/chains.js';
import { assertProfileName, createProfile } from '../../lib/profiles.js';

export async function profileCreateCommand(
  name: string,
  options: ProfileCreateOptions
): Promise<void> {
  assertProfileName(name);
  const path = resolveProfilePath(name);
  await createProfile(path, Boolean(options.empty));

  const chains = Object.keys((await loadProfile(path)).chains);
  if (options.json) {
    console.log(JSON.stringify({ profile: name, path, chains }, null, 2));
    return;
  }

  console.log(`Created profile ${chalk.bold(name)} ${chalk.dim(path)}`);
  console.log(
    chains.length === 0
      ? chalk.dim('  empty — add chains with: evm chain set <chain> <rpc-url>')
      : chalk.dim(`  ${chains.length} chains from the bundled profile: ${chains.join(', ')}`)
  );
  console.log(chalk.dim(`  use it with: -p ${name}, or make it the default: evm profile set-default ${name}`));
}
