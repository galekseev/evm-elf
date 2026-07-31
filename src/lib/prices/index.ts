/**
 * Price source selection. Set EVM_PRICE_SOURCE=none to disable
 * price lookups entirely (offline use, CI).
 */

import { CoinGeckoPriceSource } from './coingecko.js';
import type { PriceSource } from './types.js';

export type { PriceChain, PriceSource } from './types.js';

class NonePriceSource implements PriceSource {
  readonly name = 'none';

  async getNativeUsdPrices(): Promise<Map<number, number | null>> {
    return new Map();
  }
}

export function resolvePriceSource(name?: string): PriceSource {
  switch ((name ?? process.env.EVM_PRICE_SOURCE ?? 'coingecko').toLowerCase()) {
    case 'none':
      return new NonePriceSource();
    default:
      return new CoinGeckoPriceSource();
  }
}
