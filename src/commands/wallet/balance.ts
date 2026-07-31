/**
 * balance command - native token balance, USD value and nonce across chains
 */

import chalk from 'chalk';
import { formatEther } from 'ethers';
import type { BalanceResult, RpcProfile, WalletBalanceOptions } from '../../types.js';
import { loadEnv } from '../../lib/env.js';
import { resolveAddress } from '../../lib/wallet.js';
import {
  loadProfile,
  loadKnownChains,
  resolveChain,
  selectChains,
} from '../../lib/chains.js';
import { createProvider } from '../../lib/rpc.js';
import { getNativeToken } from '../../lib/native-token.js';
import { resolvePriceSource } from '../../lib/prices/index.js';

const COL = {
  chain: 15,
  chainId: 10,
  balance: 25,
  token: 8,
  usd: 16,
  nonce: 10,
} as const;

const USD_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function formatUsd(value: number): string {
  return value > 0 && value < 0.01 ? '<$0.01' : USD_FORMAT.format(value);
}

/**
 * Value the balances in USD in place. Chains the price source cannot price
 * keep priceUsd/valueUsd unset.
 */
async function addUsdValues(results: BalanceResult[]): Promise<void> {
  const chainIds = [...new Set(results.filter((r) => !r.error).map((r) => r.chainId))];
  if (chainIds.length === 0) {
    return;
  }

  const prices = await resolvePriceSource().getNativeUsdPrices(chainIds);
  for (const result of results) {
    const price = prices.get(result.chainId);
    if (result.error || price === undefined || price === null) {
      continue;
    }
    result.priceUsd = price;
    result.valueUsd = Number(result.balanceEth) * price;
  }
}

export async function balanceCommand(wallet: string, options: WalletBalanceOptions): Promise<void> {
  loadEnv();

  let address: string;
  try {
    address = resolveAddress(wallet);
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  const knownChains = await loadKnownChains();
  let profile: RpcProfile | undefined;
  if (options.profile) {
    profile = await loadProfile(options.profile);
  }

  const chains = selectChains(options.chain, options.excludeChain, profile, knownChains);
  const showUsd = options.usd !== false;
  const results: BalanceResult[] = [];

  for (const chain of chains) {
    const resolved = resolveChain(chain, profile, knownChains);
    const symbol = getNativeToken(resolved.chainId)?.symbol;
    if (!resolved.endpoint) {
      results.push({
        chain,
        chainId: resolved.chainId,
        address,
        balance: '0',
        balanceEth: '0',
        nonce: 0,
        ...(symbol ? { symbol } : {}),
        error: resolved.error,
      });
      continue;
    }

    const provider = createProvider(resolved.endpoint, resolved.chainId);
    try {
      const [balance, nonce] = await Promise.all([
        provider.getBalance(address),
        provider.getTransactionCount(address, 'pending'),
      ]);
      results.push({
        chain,
        chainId: resolved.chainId,
        address,
        balance: balance.toString(),
        balanceEth: formatEther(balance),
        nonce,
        ...(symbol ? { symbol } : {}),
      });
    } catch (err) {
      results.push({
        chain,
        chainId: resolved.chainId,
        address,
        balance: '0',
        balanceEth: '0',
        nonce: 0,
        ...(symbol ? { symbol } : {}),
        error: (err as Error).message,
      });
    } finally {
      provider.destroy();
    }
  }

  if (showUsd) {
    await addUsdValues(results);
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const header =
    [
      'Chain'.padEnd(COL.chain),
      'Chain ID'.padEnd(COL.chainId),
      'Balance (Native)'.padEnd(COL.balance),
      'Token'.padEnd(COL.token),
      ...(showUsd ? ['Value (USD)'.padEnd(COL.usd)] : []),
      'Nonce'.padEnd(COL.nonce),
    ].join(' ') + ' Status';

  console.log();
  console.log(`Wallet Balance: ${chalk.bold(address)}`);
  console.log();
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const result of results) {
    const head = [
      result.chain.padEnd(COL.chain),
      result.chainId.toString().padEnd(COL.chainId),
    ];
    const token = chalk.dim((result.symbol ?? '-').padEnd(COL.token));

    if (result.error) {
      const cells = [...head, '-'.padEnd(COL.balance), token];
      if (showUsd) cells.push('-'.padEnd(COL.usd));
      cells.push('-'.padEnd(COL.nonce), chalk.red(result.error));
      console.log(cells.join(' '));
      continue;
    }

    const balanceColor = parseFloat(result.balanceEth) < 0.01 ? chalk.yellow : chalk.cyan;
    const cells = [...head, balanceColor(result.balanceEth.padEnd(COL.balance)), token];
    if (showUsd) {
      cells.push(
        result.valueUsd === undefined
          ? chalk.dim('-'.padEnd(COL.usd))
          : chalk.cyan(formatUsd(result.valueUsd).padEnd(COL.usd))
      );
    }
    cells.push(chalk.cyan(result.nonce.toString().padEnd(COL.nonce)), chalk.green('OK'));
    console.log(cells.join(' '));
  }

  const priced = showUsd ? results.filter((r) => r.valueUsd !== undefined) : [];
  if (priced.length > 0) {
    const total = priced.reduce((sum, r) => sum + (r.valueUsd ?? 0), 0);
    const labelWidth = COL.chain + COL.chainId + COL.balance + COL.token + 3;
    console.log('─'.repeat(header.length));
    console.log(`${'Total'.padEnd(labelWidth)} ${chalk.bold(formatUsd(total))}`);

    const unpriced = results.filter(
      (r) => !r.error && r.valueUsd === undefined && parseFloat(r.balanceEth) > 0
    );
    if (unpriced.length > 0) {
      console.log(
        chalk.dim(`No price for: ${unpriced.map((r) => r.chain).join(', ')} (excluded from total)`)
      );
    }
  }

  console.log();
}
