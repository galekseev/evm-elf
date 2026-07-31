/**
 * profile set-default command - point the profiles/.default file at a profile
 */

import { existsSync } from 'fs';
import chalk from 'chalk';
import type { ProfileSetDefaultOptions } from '../../types.js';
import { DEFAULT_PROFILE_NAME, resolveDefaultProfile } from '../../lib/env.js';
import { resolveProfilePath } from '../../lib/chains.js';
import {
  assertProfileName,
  ensureDefaultProfile,
  listProfileFiles,
  writeDefaultPointer,
} from '../../lib/profiles.js';

export async function profileSetDefaultCommand(
  name: string,
  options: ProfileSetDefaultOptions
): Promise<void> {
  assertProfileName(name);
  const path = resolveProfilePath(name);

  if (!existsSync(path) && name === DEFAULT_PROFILE_NAME) {
    await ensureDefaultProfile(path);
  }
  if (!existsSync(path)) {
    const available = (await listProfileFiles()).map((file) => file.name).join(', ');
    throw new Error(
      `Profile not found: ${path} (available: ${available || 'none'}; create it with evm profile create ${name})`
    );
  }

  const previous = resolveDefaultProfile();
  await writeDefaultPointer(name);

  if (options.json) {
    console.log(JSON.stringify({ default: name, path, previous: previous.name }, null, 2));
    return;
  }

  console.log(`Default profile is now ${chalk.bold(name)} ${chalk.dim(path)}`);
  if (previous.name !== name) {
    console.log(chalk.dim(`  was ${previous.name}`));
  }
  if (previous.source === 'env') {
    console.log(
      chalk.yellow(`  $EVM_ELF_PROFILE is set to '${previous.name}' and overrides this until unset`)
    );
  }
}
