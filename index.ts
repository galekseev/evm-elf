#!/usr/bin/env node
/**
 * evm - multi-chain EVM wallet and contract CLI
 *
 * Reads fan out across every chain in the profile unless narrowed with -c/-xc;
 * writes print a plan and need --exec to actually send.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { buildWalletCommand } from './src/cli/wallet.js';
import { buildContractCommand } from './src/cli/contract.js';
import { buildChainCommand } from './src/cli/chain.js';
import { buildExplorerCommand } from './src/cli/explorer.js';
import { buildProfileCommand } from './src/cli/profile.js';
import { PACKAGE_ROOT, PROFILES_DIR } from './src/lib/env.js';

const { version } = JSON.parse(
  readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf-8')
) as { version: string };

const program = new Command();

program
  .name('evm')
  .description('Multi-chain EVM wallet and contract utilities')
  .version(version)
  .addHelpText(
    'after',
    `
Configuration:
  Profiles              ${PROFILES_DIR}/<name>.yaml
  Profile in use        -p <name>, else $EVM_ELF_PROFILE, else the one set by
                        evm profile set-default, else "default"
  Edit the chains       evm chain set <chain> <rpc-url>
  Explorer API keys     evm explorer set etherscan '\${ETHERSCAN_API_KEY}'
  Manage the profiles   evm profile list

A profile holds every chain the CLI knows about, with its RPC URL and headers,
plus the block explorer keys used by contract lookups. The default profile is
created from the bundled one on first use. Environment is read from ./.env, then
from the user config directory.`
  );

program.addCommand(buildWalletCommand());
program.addCommand(buildContractCommand());
program.addCommand(buildChainCommand());
program.addCommand(buildExplorerCommand());
program.addCommand(buildProfileCommand());

// Action handlers are async, so a rejection would otherwise surface as an
// unhandled rejection with a Node stack trace.
program.parseAsync().catch((error: unknown) => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
