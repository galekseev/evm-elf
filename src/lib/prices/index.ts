/**
 * Price source selection. Set EVM_PRICE_SOURCE=none to disable
 * price lookups entirely (offline use, CI).
 */

import chalk from 'chalk';
import { CoinGeckoPriceSource } from './coingecko.js';
import type { PriceSource } from './types.js';

export type { PriceChain, PriceSource } from './types.js';

class NonePriceSource implements PriceSource {
  readonly name = 'none';

  async getNativeUsdPrices(): Promise<Map<number, number | null>> {
    return new Map();
  }
}

/**
 * CoinGecko when nothing is set, otherwise the named source. A name that is
 * neither falls back to 'none' rather than to the default: someone who set the
 * variable at all meant to control the lookup, and reaching for the network
 * because they misspelled 'none' is the wrong way to be wrong. Said on stderr
 * so that --json stays parseable.
 */
export function resolvePriceSource(name?: string): PriceSource {
  const configured = name ?? process.env.EVM_PRICE_SOURCE;
  if (!configured) {
    return new CoinGeckoPriceSource();
  }
  switch (configured.toLowerCase()) {
    case 'coingecko':
      return new CoinGeckoPriceSource();
    case 'none':
      return new NonePriceSource();
    default:
      console.error(
        chalk.yellow(
          `Warning: unknown price source '${configured}', using 'none' (valid: coingecko, none)`
        )
      );
      return new NonePriceSource();
  }
}
