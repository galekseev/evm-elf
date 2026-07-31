/**
 * `evm chain` subcommands - configure the chains a profile describes
 */

import { Command } from 'commander';
import { chainListCommand } from '../commands/chain/list.js';
import { chainSetCommand } from '../commands/chain/set.js';
import { chainRemoveCommand } from '../commands/chain/remove.js';

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function buildChainCommand(): Command {
  const chain = new Command('chain').description('Configure the chains in a profile');

  chain
    .command('list')
    .description('List the chains a profile configures')
    .option('-p, --profile <nameOrPath>', 'Profile to read (default: default, or $EVM_ELF_PROFILE)')
    .option('--reveal', 'Print header values instead of masking them')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm chain list
  $ evm chain list -p myproject --json`
    )
    .action(chainListCommand);

  chain
    .command('set <chain> [rpcUrl]')
    .description('Add a chain to a profile or change an existing one')
    .option('-p, --profile <nameOrPath>', 'Profile to edit (default: default, or $EVM_ELF_PROFILE)')
    .option('--chain-id <id>', 'Chain id (default: read from the RPC)')
    .option('-H, --header <name:value>', 'HTTP header sent with every RPC request (repeatable)', collect)
    .option('--remove-header <name>', 'Drop a header (repeatable)', collect)
    .option('--symbol <symbol>', 'Native token symbol, e.g. ETH')
    .option('--coingecko-id <id>', 'CoinGecko coin id, needed for USD values')
    .option('--explorer-api <url>', 'Etherscan-compatible API for chains outside Etherscan v2')
    .option('--no-verify', 'Skip the eth_chainId check (needs --chain-id)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
The chain id is read from the endpoint unless --chain-id says otherwise, and a
mismatch is an error. Header values and RPC URLs may reference the environment
as \${VAR}, which keeps secrets out of the file. An empty value clears a field
(--symbol '').

Examples:
  $ evm chain set base https://mainnet.base.org
  $ evm chain set arbitrum '\${ARBITRUM_RPC_URL}' -H 'auth-key:\${ARBITRUM_AUTH_KEY}'
  $ evm chain set base -H 'auth-key:secret'
  $ evm chain set local http://127.0.0.1:8545 --chain-id 31337 --no-verify
  $ evm chain set base https://mainnet.base.org -p myproject`
    )
    .action(chainSetCommand);

  chain
    .command('remove <chain>')
    .description('Remove a chain from a profile')
    .option('-p, --profile <nameOrPath>', 'Profile to edit (default: default, or $EVM_ELF_PROFILE)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm chain remove sepolia
  $ evm chain remove sepolia -p myproject`
    )
    .action(chainRemoveCommand);

  return chain;
}
