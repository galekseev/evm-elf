/**
 * Native token USD price lookup, abstracted over the price provider.
 *
 * Keyed by chain id rather than by coin symbol so that implementations backed
 * by on-chain data (price feed per chain) fit the same interface as ones
 * backed by a coin list.
 */

export interface PriceSource {
  readonly name: string;
  /**
   * Batch lookup of USD prices per native unit. Never throws: chains the
   * source cannot price resolve to null.
   */
  getNativeUsdPrices(chainIds: number[]): Promise<Map<number, number | null>>;
}
