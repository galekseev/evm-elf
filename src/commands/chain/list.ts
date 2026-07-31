/**
 * chain list command - show the chains a profile configures
 * Header values are masked unless --reveal: a profile may hold a literal API key.
 */

import chalk from 'chalk';
import type { ChainListOptions } from '../../types.js';
import { loadEnv } from '../../lib/env.js';
import { loadProfile } from '../../lib/chains.js';

const COL = {
  chain: 15,
  chainId: 10,
  rpc: 45,
  token: 8,
} as const;

const ENV_REF = /^\$\{([^}]+)\}$/;

/** Keep an env reference readable, mask anything that could be a literal secret */
function maskValue(value: string, reveal: boolean): string {
  const ref = ENV_REF.exec(value);
  if (ref) {
    return process.env[ref[1]] === undefined ? `${value} ${chalk.yellow('(unset)')}` : value;
  }
  if (reveal) {
    return value;
  }
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

export async function chainListCommand(options: ChainListOptions): Promise<void> {
  loadEnv();

  const profile = await loadProfile(options.profile);
  const entries = Object.entries(profile.chains);

  if (options.json) {
    console.log(JSON.stringify({ profile: profile.name, path: profile.path, chains: profile.chains }, null, 2));
    return;
  }

  console.log();
  console.log(`Profile ${chalk.bold(profile.name)} ${chalk.dim(profile.path)}`);
  console.log();

  if (entries.length === 0) {
    console.log(chalk.dim('No chains configured. Add one: evm chain set base <rpc-url>'));
    console.log();
    return;
  }

  const header = [
    'Chain'.padEnd(COL.chain),
    'Chain ID'.padEnd(COL.chainId),
    'RPC URL'.padEnd(COL.rpc),
    'Token'.padEnd(COL.token),
  ].join(' ') + ' Headers';

  console.log(header);
  console.log('─'.repeat(header.length));

  for (const [chain, config] of entries) {
    const headers = Object.entries(config.headers ?? {})
      .map(([name, value]) => `${name}: ${maskValue(value, Boolean(options.reveal))}`)
      .join(', ');
    const rpc = config.rpc_url
      ? chalk.cyan(truncate(config.rpc_url, COL.rpc).padEnd(COL.rpc))
      : chalk.red('not set'.padEnd(COL.rpc));
    const chainId = config.chain_id
      ? config.chain_id.toString().padEnd(COL.chainId)
      : chalk.red('not set'.padEnd(COL.chainId));

    console.log(
      [
        chain.padEnd(COL.chain),
        chainId,
        rpc,
        chalk.dim((config.symbol ?? '-').padEnd(COL.token)),
      ].join(' ') + ` ${chalk.dim(headers)}`
    );
  }

  console.log();
}
