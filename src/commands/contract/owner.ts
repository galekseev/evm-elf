/**
 * contract owner command - read owner() of a contract across chains
 */

import chalk from 'chalk';
import { Contract, isAddress } from 'ethers';
import type { ContractOwnerResult, WalletOptions } from '../../types.js';
import { loadProfile, resolveChain, selectChains } from '../../lib/chains.js';
import { createProvider } from '../../lib/rpc.js';
import { OWNABLE_ABI, hasCode } from '../../lib/proxy.js';

export async function ownerCommand(address: string, options: WalletOptions): Promise<void> {
  if (!isAddress(address)) {
    console.error(chalk.red(`Invalid Ethereum address: ${address}`));
    process.exit(1);
  }

  const profile = await loadProfile(options.profile);
  const chains = selectChains(options.chain, options.excludeChain, profile);
  const results: ContractOwnerResult[] = [];

  for (const chain of chains) {
    const resolved = resolveChain(chain, profile);
    if (!resolved.endpoint) {
      results.push({ chain, chainId: resolved.chainId, address, error: resolved.error });
      continue;
    }

    const provider = createProvider(resolved.endpoint, resolved.chainId);
    try {
      if (!(await hasCode(provider, address))) {
        results.push({ chain, chainId: resolved.chainId, address, error: 'no code at address' });
        continue;
      }
      const contract = new Contract(address, OWNABLE_ABI, provider);
      try {
        const owner = (await contract.owner()) as string;
        results.push({ chain, chainId: resolved.chainId, address, owner });
      } catch {
        results.push({ chain, chainId: resolved.chainId, address, error: 'no owner() function' });
      }
    } catch (err) {
      results.push({ chain, chainId: resolved.chainId, address, error: (err as Error).message });
    } finally {
      provider.destroy();
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log();
  console.log(`Contract Owner: ${chalk.bold(address)}`);
  console.log();
  console.log(`${'Chain'.padEnd(15)} ${'Chain ID'.padEnd(10)} Owner`);
  console.log('─'.repeat(70));

  for (const result of results) {
    const chainCol = result.chain.padEnd(15);
    const idCol = result.chainId.toString().padEnd(10);

    if (result.error) {
      console.log(`${chainCol} ${idCol} ${chalk.red(result.error)}`);
    } else {
      console.log(`${chainCol} ${idCol} ${chalk.cyan(result.owner)}`);
    }
  }

  console.log();
}
