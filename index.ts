#!/usr/bin/env node
/**
 * evm - multi-chain EVM wallet and contract CLI
 *
 * Reads fan out across every known chain unless narrowed with -c/-xc; writes
 * print a plan and need --exec to actually send.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { buildWalletCommand } from './src/cli/wallet.js';
import { buildContractCommand } from './src/cli/contract.js';
import { PACKAGE_ROOT, PROFILES_DIR, USER_CHAINS_PATH } from './src/lib/env.js';

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
  Chain list override   ${USER_CHAINS_PATH}
  RPC profiles          ${PROFILES_DIR}/<name>.yaml
  RPC URL per chain     <CHAIN>_RPC_URL environment variable (e.g. BASE_RPC_URL)

Environment is read from ./.env, then from the user config directory.`
  );

program.addCommand(buildWalletCommand());
program.addCommand(buildContractCommand());

// Action handlers are async, so a rejection would otherwise surface as an
// unhandled rejection with a Node stack trace.
program.parseAsync().catch((error: unknown) => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
