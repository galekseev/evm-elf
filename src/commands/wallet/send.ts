/**
 * send command - transfer native ETH on one or more chains.
 *
 * Two amount modes (mutually exclusive):
 * - --value <amount>: send a fixed amount on each chain
 * - --all: sweep the entire balance minus a gas reserve (gasLimit * maxFeePerGas
 *   * --fee-buffer). The unused part of the reserve stays behind as dust.
 */

import chalk from 'chalk';
import { Wallet, formatEther, isAddress, parseEther } from 'ethers';
import type { SendResult, WalletSendOptions } from '../../types.js';
import { loadEnv } from '../../lib/env.js';
import { loadProfile, resolveChain, selectChains } from '../../lib/chains.js';
import { createProvider } from '../../lib/rpc.js';
import { resolvePrivateKey } from '../../lib/wallet.js';

const DEFAULT_FEE_BUFFER = 1.1;

/**
 * Parse a value amount: "0.01", "0.01ether" or a raw wei string like "10000000wei"
 */
function parseValue(raw: string): bigint {
  const trimmed = raw.trim();
  if (/^\d+wei$/.test(trimmed)) {
    return BigInt(trimmed.slice(0, -3));
  }
  const etherAmount = trimmed.replace(/ether$/, '');
  return parseEther(etherAmount);
}

export async function sendCommand(to: string, options: WalletSendOptions): Promise<void> {
  loadEnv();

  if (!isAddress(to)) {
    console.error(chalk.red(`Invalid recipient address: ${to}`));
    process.exit(1);
  }

  if (!options.all && options.value === undefined) {
    console.error(chalk.red('send requires either --value <amount> or --all'));
    process.exit(1);
  }

  let fixedValue: bigint | undefined;
  if (!options.all) {
    try {
      fixedValue = parseValue(options.value!);
    } catch {
      console.error(chalk.red(`Invalid --value: ${options.value}`));
      process.exit(1);
    }
  }

  const feeBuffer = options.feeBuffer !== undefined ? Number(options.feeBuffer) : DEFAULT_FEE_BUFFER;
  if (!Number.isFinite(feeBuffer) || feeBuffer < 1) {
    console.error(chalk.red(`Invalid --fee-buffer: ${options.feeBuffer} (must be a number >= 1)`));
    process.exit(1);
  }

  let privateKey: string;
  try {
    privateKey = resolvePrivateKey(options.privateKey);
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  const profile = await loadProfile(options.profile);
  const chains = selectChains(options.chain, options.excludeChain, profile);
  if (chains.length === 0) {
    console.error(chalk.red('No chains selected'));
    process.exit(1);
  }

  const quiet = Boolean(options.json);
  const planOnly = Boolean(options.all) && !options.exec;
  const results: SendResult[] = [];

  if (!quiet) {
    console.log();
    const mode = options.all
      ? `sweep entire balance (fee buffer x${feeBuffer})`
      : `${formatEther(fixedValue!)} ETH`;
    console.log(`Wallet Send: ${mode} → ${chalk.bold(to)}`);
    if (planOnly) {
      console.log(chalk.dim('(plan only — pass --exec to send transactions)'));
    }
    console.log();
  }

  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i];
    const progress = chalk.dim(`[${i + 1}/${chains.length}]`);
    const resolved = resolveChain(chain, profile);

    const base: SendResult = {
      chain,
      chainId: resolved.chainId,
      from: '',
      to,
      value: '0',
      valueEth: '0',
    };

    if (!resolved.endpoint) {
      if (!quiet) console.log(`${progress} ${chain}: ${chalk.red(resolved.error)}`);
      results.push({ ...base, error: resolved.error });
      continue;
    }

    const provider = createProvider(resolved.endpoint, resolved.chainId);
    const wallet = new Wallet(privateKey, provider);
    base.from = wallet.address;

    try {
      let value: bigint;
      let txOverrides: Record<string, bigint> = {};

      if (options.all) {
        const balance = await provider.getBalance(wallet.address);
        if (balance === 0n) {
          if (!quiet) console.log(`${progress} ${chain}: ${chalk.dim('skip (zero balance)')}`);
          results.push({ ...base, skipped: 'zero balance' });
          continue;
        }

        const feeData = await provider.getFeeData();
        const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
        if (!maxFeePerGas) {
          throw new Error('Could not determine gas price');
        }
        const gasLimit = await provider.estimateGas({ from: wallet.address, to, value: 1n });
        const reserve =
          (gasLimit * maxFeePerGas * BigInt(Math.round(feeBuffer * 100))) / 100n;
        value = balance - reserve;

        if (value <= 0n) {
          const msg = `balance too low (${formatEther(balance)} ETH, gas reserve ${formatEther(reserve)} ETH)`;
          if (!quiet) console.log(`${progress} ${chain}: ${chalk.dim(`skip (${msg})`)}`);
          results.push({ ...base, skipped: msg });
          continue;
        }

        // Pin gas params so the actual fee can never exceed the reserve
        txOverrides = feeData.maxFeePerGas
          ? {
              gasLimit,
              maxFeePerGas,
              maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
            }
          : { gasLimit, gasPrice: maxFeePerGas };
      } else {
        value = fixedValue!;
      }

      if (planOnly) {
        if (!quiet) {
          console.log(`${progress} ${chain}: would send ${chalk.cyan(formatEther(value))} ETH`);
        }
        results.push({
          ...base,
          value: value.toString(),
          valueEth: formatEther(value),
        });
        continue;
      }

      if (!quiet) {
        console.log(`${progress} ${chain}: sending ${chalk.cyan(formatEther(value))} ETH...`);
      }

      const tx = await wallet.sendTransaction({ to, value, ...txOverrides });
      const receipt = options.wait === false ? null : await tx.wait();

      if (!quiet) {
        const blockInfo = receipt
          ? `block ${receipt.blockNumber}`
          : 'not waiting for receipt';
        console.log(`${progress} ${chain}: ${chalk.green('sent')} ${chalk.cyan(tx.hash)} (${blockInfo})`);
      }

      results.push({
        ...base,
        value: value.toString(),
        valueEth: formatEther(value),
        txHash: tx.hash,
        ...(receipt ? { blockNumber: receipt.blockNumber } : {}),
      });
    } catch (error) {
      const message = (error as Error).message;
      if (!quiet) console.log(`${progress} ${chain}: ${chalk.red(message)}`);
      results.push({ ...base, error: message });
    } finally {
      provider.destroy();
    }
  }

  printResults(results, options);

  const allFailed = results.length > 0 && results.every((r) => r.error);
  if (allFailed) {
    process.exit(1);
  }
}

function printResults(results: SendResult[], options: WalletSendOptions): void {
  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log();
  console.log(
    `${'Chain'.padEnd(15)} ${'Chain ID'.padEnd(10)} ${'Value Sent'.padEnd(25)} Status`
  );
  console.log('─'.repeat(90));

  for (const result of results) {
    const chainCol = result.chain.padEnd(15);
    const idCol = result.chainId.toString().padEnd(10);

    if (result.error) {
      console.log(`${chainCol} ${idCol} ${'-'.padEnd(25)} ${chalk.red(result.error)}`);
    } else if (result.skipped) {
      console.log(`${chainCol} ${idCol} ${'-'.padEnd(25)} ${chalk.dim(`skip (${result.skipped})`)}`);
    } else if (!result.txHash) {
      console.log(`${chainCol} ${idCol} ${chalk.cyan(result.valueEth.padEnd(25))} ${chalk.cyan('will send')}`);
    } else {
      const status = result.blockNumber !== undefined
        ? chalk.green(`sent, block ${result.blockNumber}`)
        : chalk.green('sent (not waiting for receipt)');
      console.log(
        `${chainCol} ${idCol} ${chalk.cyan(result.valueEth.padEnd(25))} ${status} ${chalk.dim(result.txHash ?? '')}`
      );
    }
  }

  console.log();
}
