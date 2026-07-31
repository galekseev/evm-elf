/**
 * `evm contract` subcommands - ownership, proxy inspection, upgrades, bytecode
 */

import { Command, Option } from 'commander';
import { ownerCommand } from '../commands/contract/owner.js';
import { transferOwnershipCommand } from '../commands/contract/transfer-ownership.js';
import { proxyInfoCommand } from '../commands/contract/proxy-info.js';
import { proxyUpgradeCommand } from '../commands/contract/proxy-upgrade.js';
import { codeCommand } from '../commands/contract/code.js';

export function buildContractCommand(): Command {
  const contract = new Command('contract').description(
    'Contract utilities (ownership, proxy inspection, upgrades)'
  );

  contract
    .command('owner <address>')
    .description('Read owner() of a contract across chains')
    .option('-c, --chain <chains>', 'Chain(s) to query (comma-separated; default: every chain in the profile)')
    .addOption(
      new Option('-xc, --exclude-chain <chains>', 'Exclude chain(s) from the profile (comma-separated)').conflicts('chain')
    )
    .option('-p, --profile <nameOrPath>', 'Profile to use (default: default, or $EVM_ELF_PROFILE)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm contract owner 0x5d0F...95eB
  $ evm contract owner 0x5d0F...95eB -c base,arbitrum`
    )
    .action(ownerCommand);

  contract
    .command('transfer-ownership <address> <newOwner>')
    .description('Call transferOwnership(newOwner) on a contract (dry-run by default)')
    .requiredOption('-c, --chain <chain>', 'Chain to operate on (single chain)')
    .requiredOption('--private-key <key>', 'Private key (hex or env var name)')
    .option('-p, --profile <nameOrPath>', 'Profile to use (default: default, or $EVM_ELF_PROFILE)')
    .option('--exec', 'Send the transaction (default: dry-run with static call)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm contract transfer-ownership 0x5d0F...95eB 0xNewOwner... --private-key DEPLOYER_PK -c base
  $ evm contract transfer-ownership 0x5d0F...95eB 0xNewOwner... --private-key DEPLOYER_PK -c base --exec`
    )
    .action(transferOwnershipCommand);

  contract
    .command('proxy-info <address>')
    .description('Auto-detect proxy type and inspect it (implementation, admin, owners) across chains')
    .option('-c, --chain <chains>', 'Chain(s) to query (comma-separated; default: every chain in the profile)')
    .addOption(
      new Option('-xc, --exclude-chain <chains>', 'Exclude chain(s) from the profile (comma-separated)').conflicts('chain')
    )
    .option('-p, --profile <nameOrPath>', 'Profile to use (default: default, or $EVM_ELF_PROFILE)')
    .option('-s, --short', 'Only print chain and detected proxy type (faster, skips owner lookups)')
    .option('--full', 'Extra diagnostics: code size, ProxyAdmin version, ERC-1822 check for UUPS')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm contract proxy-info 0x5d0F...95eB
  $ evm contract proxy-info 0x5d0F...95eB -s
  $ evm contract proxy-info 0x5d0F...95eB -c base --full
  $ evm contract proxy-info 0x5d0F...95eB -c base --json`
    )
    .action(proxyInfoCommand);

  contract
    .command('proxy-upgrade <proxy> <newImplementation>')
    .description('Upgrade a transparent proxy via ProxyAdmin.upgradeAndCall (dry-run by default)')
    .requiredOption('-c, --chain <chain>', 'Chain to operate on (single chain)')
    .requiredOption('--private-key <key>', 'Private key (hex or env var name)')
    .option('--data <hex>', 'Calldata for upgradeAndCall (default: 0x)')
    .option('-p, --profile <nameOrPath>', 'Profile to use (default: default, or $EVM_ELF_PROFILE)')
    .option('--exec', 'Send the transaction (default: dry-run with static call)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm contract proxy-upgrade 0xProxy... 0xNewImpl... --private-key DEPLOYER_PK -c base
  $ evm contract proxy-upgrade 0xProxy... 0xNewImpl... --private-key DEPLOYER_PK -c base --data 0x8129fc1c --exec`
    )
    .action(proxyUpgradeCommand);

  contract
    .command('code <address>')
    .description('Check deployed bytecode at an address across chains')
    .option('-c, --chain <chains>', 'Chain(s) to query (comma-separated; default: every chain in the profile)')
    .addOption(
      new Option('-xc, --exclude-chain <chains>', 'Exclude chain(s) from the profile (comma-separated)').conflicts('chain')
    )
    .option('-p, --profile <nameOrPath>', 'Profile to use (default: default, or $EVM_ELF_PROFILE)')
    .option('--full', 'Print full bytecode hex (requires exactly one chain)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ evm contract code 0x5d0F...95eB
  $ evm contract code 0x5d0F...95eB -c base --full`
    )
    .action(codeCommand);

  return contract;
}
