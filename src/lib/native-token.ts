/**
 * Native token metadata per chain (symbol + price source identifiers).
 * known-chains.yaml only maps chain names to ids, so the symbol and the
 * CoinGecko coin id live here.
 */

export interface NativeToken {
  symbol: string;
  /** CoinGecko coin id; absent when the native token has no meaningful USD price */
  coingeckoId?: string;
  testnet?: boolean;
}

const ETHER: NativeToken = { symbol: 'ETH', coingeckoId: 'ethereum' };

export const NATIVE_TOKENS: Record<number, NativeToken> = {
  1: ETHER,
  10: ETHER,
  56: { symbol: 'BNB', coingeckoId: 'binancecoin' },
  100: { symbol: 'xDAI', coingeckoId: 'xdai' },
  130: ETHER,
  // Polygon's gas token is POL, not MATIC
  137: { symbol: 'POL', coingeckoId: 'polygon-ecosystem-token' },
  146: { symbol: 'S', coingeckoId: 'sonic-3' },
  324: ETHER,
  4663: ETHER,
  8453: ETHER,
  42161: ETHER,
  43114: { symbol: 'AVAX', coingeckoId: 'avalanche-2' },
  59144: ETHER,
  11155111: { symbol: 'ETH', testnet: true },
};

export function getNativeToken(chainId: number): NativeToken | undefined {
  return NATIVE_TOKENS[chainId];
}
