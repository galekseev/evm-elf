/**
 * profile remove command - delete a profile file
 */

import { existsSync } from 'fs';
import chalk from 'chalk';
import type { ProfileRemoveOptions } from '../../types.js';
import { DEFAULT_PROFILE_NAME, resolveDefaultProfile } from '../../lib/env.js';
import { resolveProfilePath } from '../../lib/chains.js';
import {
  assertProfileName,
  clearDefaultPointer,
  deleteProfile,
  listProfileFiles,
  readDefaultPointer,
} from '../../lib/profiles.js';

export async function profileRemoveCommand(
  name: string,
  options: ProfileRemoveOptions
): Promise<void> {
  assertProfileName(name);
  const path = resolveProfilePath(name);
  if (!existsSync(path)) {
    const available = (await listProfileFiles()).map((file) => file.name).join(', ');
    throw new Error(`Profile not found: ${path} (available: ${available || 'none'})`);
  }

  const active = resolveDefaultProfile();
  if (active.name === name && !options.force) {
    throw new Error(
      `'${name}' is the profile in use; pass --force to remove it, or point elsewhere first with evm profile set-default <name>`
    );
  }

  const pointed = readDefaultPointer() === name;
  await deleteProfile(path);
  if (pointed) {
    await clearDefaultPointer();
  }

  if (options.json) {
    console.log(JSON.stringify({ removed: name, path, defaultCleared: pointed }, null, 2));
    return;
  }

  console.log(`Removed profile ${chalk.bold(name)} ${chalk.dim(path)}`);
  if (pointed) {
    console.log(chalk.dim(`  the default is back to '${DEFAULT_PROFILE_NAME}'`));
  }
  if (name === DEFAULT_PROFILE_NAME) {
    console.log(chalk.dim('  it will be recreated from the bundled profile on next use'));
  }
}
