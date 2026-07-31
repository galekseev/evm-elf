/**
 * contract code command - check deployed bytecode at an address across chains
 */

import chalk from 'chalk';
import { isAddress } from 'ethers';
import type { CodeResult, WalletCodeOptions } from '../../types.js';
import { loadEnv } from '../../lib/env.js';
import { loadProfile, resolveChain, selectChains } from '../../lib/chains.js';
import { createProvider } from '../../lib/rpc.js';

export async function codeCommand(address: string, options: WalletCodeOptions): Promise<void> {
  loadEnv();

  if (!isAddress(address)) {
    console.error(chalk.red(`Invalid Ethereum address: ${address}`));
    process.exit(1);
  }

  const profile = await loadProfile(options.profile);
  const chains = selectChains(options.chain, options.excludeChain, profile);

  if (options.full && chains.length !== 1) {
    console.error(chalk.red('--full requires exactly one chain (use -c <chain>)'));
    process.exit(1);
  }

  const results: CodeResult[] = [];

  for (const chain of chains) {
    const resolved = resolveChain(chain, profile);
    if (!resolved.endpoint) {
      results.push({
        chain,
        chainId: resolved.chainId,
        address,
        codeSize: 0,
        deployed: false,
        error: resolved.error,
      });
      continue;
    }

    const provider = createProvider(resolved.endpoint, resolved.chainId);
    try {
      const code = await provider.getCode(address);
      const codeSize = code === '0x' ? 0 : (code.length - 2) / 2;
      results.push({
        chain,
        chainId: resolved.chainId,
        address,
        codeSize,
        deployed: codeSize > 0,
        ...(options.full ? { code } : {}),
      });
    } catch (err) {
      results.push({
        chain,
        chainId: resolved.chainId,
        address,
        codeSize: 0,
        deployed: false,
        error: (err as Error).message,
      });
    } finally {
      provider.destroy();
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log();
  console.log(`Contract Code: ${chalk.bold(address)}`);
  console.log();
  console.log(`${'Chain'.padEnd(15)} ${'Chain ID'.padEnd(10)} ${'Code Size'.padEnd(12)} Status`);
  console.log('─'.repeat(60));

  for (const result of results) {
    const chainCol = result.chain.padEnd(15);
    const idCol = result.chainId.toString().padEnd(10);

    if (result.error) {
      console.log(`${chainCol} ${idCol} ${'-'.padEnd(12)} ${chalk.red(result.error)}`);
    } else if (result.deployed) {
      console.log(
        `${chainCol} ${idCol} ${chalk.cyan(`${result.codeSize} B`.padEnd(12))} ${chalk.green('deployed')}`
      );
    } else {
      console.log(`${chainCol} ${idCol} ${'0 B'.padEnd(12)} ${chalk.dim('empty')}`);
    }
  }

  console.log();

  if (options.full) {
    const result = results[0];
    if (result?.code && result.deployed) {
      console.log(result.code);
      console.log();
    }
  }
}
