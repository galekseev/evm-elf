/**
 * `evm wallet` subcommands - balance, send, nonce sync, generate, address
 */

import { Command, Option } from 'commander';
import { balanceCommand } from '../commands/wallet/balance.js';
import { setNonceCommand } from '../commands/wallet/set-nonce.js';
import { generateCommand } from '../commands/wallet/generate.js';
import { addressCommand } from '../commands/wallet/address.js';
import { sendCommand } from '../commands/wallet/send.js';

export function buildWalletCommand(): Command {
  const wallet = new Command('wallet').description(
    'Wallet utilities (balance, send, nonce sync, generate)'
  );

  wallet
    .command('balance <wallet>')
    .description('Get native balance, USD value and nonce across chains (wallet: address, private key, or env var name)')
    .option('-c, --chain <chains>', 'Chain(s) to query (comma-separated; default: every chain in the profile)')
    .addOption(
      new Option('-xc, --exclude-chain <chains>', 'Exclude chain(s) from the profile (comma-separated)').conflicts('chain')
    )
    .option('-p, --profile <nameOrPath>', 'Profile to use (default: default, or $EVM_ELF_PROFILE)')
    .option('--no-usd', 'Skip USD valuation (no price API request)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm wallet balance 0x5d0F...95eB
  $ evm wallet balance OPS_PK_REGULAR_DEPLOYER -c base
  $ evm wallet balance 0x5d0F...95eB --no-usd
  $ evm wallet balance 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
    )
    .action(balanceCommand);

  wallet
    .command('set-nonce <target>')
    .description('Bump wallet nonce to target by sending zero-value self-transactions')
    .option('-c, --chain <chains>', 'Chain(s) to update (comma-separated; default: every chain in the profile)')
    .addOption(
      new Option('-xc, --exclude-chain <chains>', 'Exclude chain(s) from the profile (comma-separated)').conflicts('chain')
    )
    .requiredOption('--private-key <key>', 'Private key (hex or env var name)')
    .option('-p, --profile <nameOrPath>', 'Profile to use (default: default, or $EVM_ELF_PROFILE)')
    .option('--exec', 'Send transactions (default: display plan only)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm wallet set-nonce 23 --private-key DEPLOYER_PK
  $ evm wallet set-nonce 23 --private-key DEPLOYER_PK -c base --exec`
    )
    .action(setNonceCommand);

  wallet
    .command('generate')
    .description('Generate a new random wallet (mnemonic + private key). Secrets are printed to stdout.')
    .option('--words <count>', 'Mnemonic length: 12 or 24', '12')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm wallet generate
  $ evm wallet generate --words 24 --json`
    )
    .action(generateCommand);

  wallet
    .command('address <private-key>')
    .description('Derive the wallet address from a private key (hex or env var name)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm wallet address DEPLOYER_PK
  $ evm wallet address 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
    )
    .action(addressCommand);

  wallet
    .command('send <to>')
    .description('Send the native token to an address on one or more chains')
    .addOption(
      new Option('--value <amount>', 'Amount: "0.01", "0.01ether" or "<wei>wei"').conflicts('all')
    )
    .addOption(
      new Option('--all', 'Sweep the entire balance minus gas reserve').conflicts('value')
    )
    .addOption(
      new Option(
        '--fee-buffer <multiplier>',
        'Gas reserve multiplier for --all (default: 1.1)'
      ).conflicts('value')
    )
    .option('--exec', 'Send transactions (default: display plan only)')
    .requiredOption('--private-key <key>', 'Private key (hex or env var name)')
    .option('-c, --chain <chains>', 'Chain(s) to send on (comma-separated; default: every chain in the profile)')
    .addOption(
      new Option('-xc, --exclude-chain <chains>', 'Exclude chain(s) from the profile (comma-separated)').conflicts('chain')
    )
    .option('-p, --profile <nameOrPath>', 'Profile to use (default: default, or $EVM_ELF_PROFILE)')
    .option('--no-wait', 'Do not wait for the transaction receipt (needs --exec)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm wallet send 0x5d0F...95eB --value 0.01 --private-key DEPLOYER_PK -c base
  $ evm wallet send 0x5d0F...95eB --value 0.01 --private-key DEPLOYER_PK -c base --exec
  $ evm wallet send 0x5d0F...95eB --all --private-key DEPLOYER_PK -c bsc,base,arbitrum
  $ evm wallet send 0x5d0F...95eB --all --exec --private-key DEPLOYER_PK -c bsc,base,arbitrum
  $ evm wallet send 0x5d0F...95eB --all --exec --fee-buffer 1.5 --private-key DEPLOYER_PK -xc mainnet`
    )
    .action(sendCommand);

  return wallet;
}
