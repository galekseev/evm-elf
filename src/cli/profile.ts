/**
 * `evm profile` subcommands - manage the profiles themselves
 */

import { Command } from 'commander';
import { profileListCommand } from '../commands/profile/list.js';
import { profileCreateCommand } from '../commands/profile/create.js';
import { profileCloneCommand } from '../commands/profile/clone.js';
import { profileRemoveCommand } from '../commands/profile/remove.js';
import { profileSetDefaultCommand } from '../commands/profile/set-default.js';

export function buildProfileCommand(): Command {
  const profile = new Command('profile').description(
    'Manage profiles (list, create, clone, remove, set-default)'
  );

  profile
    .command('list')
    .description('List the profiles on this machine and which one is the default')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm profile list
  $ evm profile list --json`
    )
    .action(profileListCommand);

  profile
    .command('create <name>')
    .description('Create a profile from the bundled one')
    .option('--empty', 'Start with no chains instead of copying the bundled profile')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm profile create myproject
  $ evm profile create myproject --empty`
    )
    .action(profileCreateCommand);

  profile
    .command('clone <source> <name>')
    .description('Copy a profile under a new name (source: profile name or path)')
    .option('--force', 'Overwrite the target profile if it exists')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm profile clone default myproject
  $ evm profile clone ./team-chains.yaml team
  $ evm profile clone default myproject --force`
    )
    .action(profileCloneCommand);

  profile
    .command('remove <name>')
    .description('Delete a profile')
    .option('--force', 'Remove it even when it is the profile in use')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm profile remove myproject
  $ evm profile remove myproject --force`
    )
    .action(profileRemoveCommand);

  profile
    .command('set-default <name>')
    .description('Use this profile when -p is not given')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
The name is written to the profiles directory as .default. $EVM_ELF_PROFILE
still wins over it, and -p wins over both.

Examples:
  $ evm profile set-default myproject
  $ evm profile set-default default    # back to the bundled profile`
    )
    .action(profileSetDefaultCommand);

  return profile;
}
