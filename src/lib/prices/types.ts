/**
 * Native token USD price lookup, abstracted over the price provider.
 *
 * Keyed by chain id rather than by coin symbol so that implementations backed
 * by on-chain data (price feed per chain) fit the same interface as ones
 * backed by a coin list. Which coin a chain's native token is comes from the
 * profile, so the caller passes it in.
 */

export interface PriceChain {
  chainId: number;
  /** CoinGecko coin id from the profile; without it the chain is unpriceable */
  coingeckoId?: string;
}

export interface PriceSource {
  readonly name: string;
  /**
   * Batch lookup of USD prices per native unit. Never throws: chains the
   * source cannot price resolve to null.
   */
  getNativeUsdPrices(chains: PriceChain[]): Promise<Map<number, number | null>>;
}
