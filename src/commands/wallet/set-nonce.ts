/**
 * set-nonce command - bump wallet nonce to a target value by sending
 * zero-value self-transactions. Without --exec only the plan is displayed.
 */

import chalk from 'chalk';
import { Wallet } from 'ethers';
import type { SetNonceResult, WalletSetNonceOptions } from '../../types.js';
import { loadProfile, resolveChain, selectChains } from '../../lib/chains.js';
import { createProvider } from '../../lib/rpc.js';
import { deriveAddress, resolvePrivateKey } from '../../lib/wallet.js';

const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

export async function setNonceCommand(
  targetArg: string,
  options: WalletSetNonceOptions
): Promise<void> {
  const targetNonce = Number(targetArg);
  if (!Number.isInteger(targetNonce) || targetNonce < 0) {
    console.error(chalk.red(`Target nonce must be a non-negative integer, got: ${targetArg}`));
    process.exit(1);
  }

  let privateKey: string;
  let address: string;
  try {
    privateKey = resolvePrivateKey(options.privateKey);
    address = deriveAddress(privateKey);
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  const profile = await loadProfile(options.profile);
  const chains = selectChains(options.chain, options.excludeChain, profile);
  const results: SetNonceResult[] = [];

  for (const chain of chains) {
    const resolved = resolveChain(chain, profile);
    const base: SetNonceResult = {
      chain,
      chainId: resolved.chainId,
      address,
      currentNonce: 0,
      targetNonce,
      txsNeeded: 0,
    };

    if (!resolved.endpoint) {
      results.push({ ...base, error: resolved.error });
      continue;
    }

    const provider = createProvider(resolved.endpoint, resolved.chainId);
    try {
      const currentNonce = await provider.getTransactionCount(address, 'pending');
      const txsNeeded = Math.max(0, targetNonce - currentNonce);
      const result: SetNonceResult = { ...base, currentNonce, txsNeeded };

      if (options.exec && txsNeeded > 0) {
        const wallet = new Wallet(privateKey, provider);
        let txsSent = 0;
        for (let nonce = currentNonce; nonce < targetNonce; nonce++) {
          await wallet.sendTransaction({ to: address, value: 0n, nonce });
          txsSent++;
        }
        result.txsSent = txsSent;
        result.finalNonce = await pollNonce(provider, address, targetNonce);
      }

      results.push(result);
    } catch (err) {
      results.push({ ...base, error: (err as Error).message });
    } finally {
      provider.destroy();
    }
  }

  printResults(address, targetNonce, results, options);

  const allFailed = results.length > 0 && results.every((r) => r.error);
  if (allFailed) {
    process.exit(1);
  }
}

/**
 * Poll until the confirmed nonce reaches the target (or timeout) and return it
 */
async function pollNonce(
  provider: ReturnType<typeof createProvider>,
  address: string,
  target: number
): Promise<number> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let nonce = 0;
  while (Date.now() < deadline) {
    nonce = await provider.getTransactionCount(address, 'latest');
    if (nonce >= target) return nonce;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return nonce;
}

function printResults(
  address: string,
  targetNonce: number,
  results: SetNonceResult[],
  options: WalletSetNonceOptions
): void {
  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log();
  console.log(`Wallet Set-Nonce: ${chalk.bold(address)} → target ${chalk.bold(targetNonce)}`);
  if (!options.exec) {
    console.log(chalk.dim('(plan only — pass --exec to send transactions)'));
  }
  console.log();
  console.log(
    `${'Chain'.padEnd(15)} ${'Chain ID'.padEnd(10)} ${'Current'.padEnd(10)} ${'Txs Needed'.padEnd(12)} Status`
  );
  console.log('─'.repeat(70));

  for (const result of results) {
    const chainCol = result.chain.padEnd(15);
    const idCol = result.chainId.toString().padEnd(10);

    if (result.error) {
      console.log(`${chainCol} ${idCol} ${'-'.padEnd(10)} ${'-'.padEnd(12)} ${chalk.red(result.error)}`);
      continue;
    }

    const currentCol = result.currentNonce.toString().padEnd(10);
    const txsCol = result.txsNeeded.toString().padEnd(12);

    let status: string;
    if (result.txsNeeded === 0) {
      status = chalk.dim(
        result.currentNonce > targetNonce ? 'skip (above target)' : 'skip (already at target)'
      );
    } else if (options.exec) {
      const reached = (result.finalNonce ?? 0) >= targetNonce;
      status = reached
        ? chalk.green(`sent ${result.txsSent}, nonce now ${result.finalNonce}`)
        : chalk.yellow(`sent ${result.txsSent}, nonce ${result.finalNonce} (timeout waiting for ${targetNonce})`);
    } else {
      status = chalk.cyan('will send');
    }

    console.log(`${chainCol} ${idCol} ${currentCol} ${txsCol} ${status}`);
  }

  console.log();
}
