/**
 * CoinGecko price source (default). One batched request per invocation
 * against the public simple/price endpoint; no API key required.
 */

import { getNativeToken } from '../native-token.js';
import type { PriceSource } from './types.js';

const SIMPLE_PRICE_API = 'https://api.coingecko.com/api/v3/simple/price';
const REQUEST_TIMEOUT_MS = 5000;

type SimplePriceResponse = Record<string, { usd?: number } | undefined>;

async function fetchSimplePrice(coinIds: string[]): Promise<SimplePriceResponse | null> {
  const url = `${SIMPLE_PRICE_API}?ids=${coinIds.join(',')}&vs_currencies=usd`;
  const apiKey = process.env.COINGECKO_API_KEY;
  try {
    const response = await fetch(url, {
      headers: apiKey ? { 'x-cg-demo-api-key': apiKey } : {},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as SimplePriceResponse;
  } catch {
    return null;
  }
}

export function toPriceMap(
  chainIds: number[],
  body: SimplePriceResponse | null
): Map<number, number | null> {
  const prices = new Map<number, number | null>();
  for (const chainId of chainIds) {
    const coinId = getNativeToken(chainId)?.coingeckoId;
    const usd = coinId ? body?.[coinId]?.usd : undefined;
    prices.set(chainId, typeof usd === 'number' && Number.isFinite(usd) ? usd : null);
  }
  return prices;
}

export class CoinGeckoPriceSource implements PriceSource {
  readonly name = 'coingecko';

  async getNativeUsdPrices(chainIds: number[]): Promise<Map<number, number | null>> {
    const coinIds = new Set<string>();
    for (const chainId of chainIds) {
      const coinId = getNativeToken(chainId)?.coingeckoId;
      if (coinId) {
        coinIds.add(coinId);
      }
    }
    if (coinIds.size === 0) {
      return toPriceMap(chainIds, null);
    }
    return toPriceMap(chainIds, await fetchSimplePrice([...coinIds]));
  }
}
