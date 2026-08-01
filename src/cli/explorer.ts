/**
 * `evm explorer` subcommands - block explorer API keys used by contract lookups
 */

import { Command } from 'commander';
import { explorerListCommand } from '../commands/explorer/list.js';
import { explorerSetCommand } from '../commands/explorer/set.js';
import { explorerRemoveCommand } from '../commands/explorer/remove.js';

export function buildExplorerCommand(): Command {
  const explorer = new Command('explorer').description(
    'Configure block explorer API keys (used by contract proxy-info)'
  );

  explorer
    .command('list')
    .description('List the explorers a profile configures')
    .option('-p, --profile <nameOrPath>', 'Profile to read (default: default, or $EVM_ELF_PROFILE)')
    .option('--reveal', 'Print literal API keys in full (${VAR} is shown as written either way)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm explorer list
  $ evm explorer list -p myproject --json`
    )
    .action(explorerListCommand);

  explorer
    .command('set <explorer> <apiKey>')
    .description('Store an API key for an explorer (etherscan, blockscout)')
    .option('-p, --profile <nameOrPath>', 'Profile to edit (default: default, or $EVM_ELF_PROFILE)')
    .option('--no-verify', 'Skip the check that the explorer accepts the key')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
One key covers every chain the explorer supports. The key is checked against the
explorer before it is written; --no-verify skips that. Keys may reference the
environment as \${VAR}, which keeps them out of the file.

Examples:
  $ evm explorer set etherscan '\${ETHERSCAN_API_KEY}'
  $ evm explorer set blockscout '\${BLOCKSCOUT_API_KEY}'
  $ evm explorer set etherscan YourEtherscanKey
  $ evm explorer set etherscan '\${ETHERSCAN_API_KEY}' --no-verify -p myproject`
    )
    .action(explorerSetCommand);

  explorer
    .command('remove <explorer>')
    .description('Remove an explorer API key from a profile')
    .option('-p, --profile <nameOrPath>', 'Profile to edit (default: default, or $EVM_ELF_PROFILE)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm explorer remove blockscout
  $ evm explorer remove etherscan -p myproject`
    )
    .action(explorerRemoveCommand);

  return explorer;
}
