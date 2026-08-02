/**
 * Unit: turning one batched price response into a price per chain.
 *
 * Every way the response can fail to price a chain — no coin id, an id the API
 * did not answer for, a value that is not a finite number — has to end as null
 * rather than as NaN, because the caller multiplies by it.
 */

import { describe, expect, it } from 'vitest';
import { toPriceMap } from '../../src/lib/prices/coingecko.js';

describe('toPriceMap', () => {
  it('maps each chain to the price of its coin', () => {
    const prices = toPriceMap(
      [
        { chainId: 1, coingeckoId: 'ethereum' },
        { chainId: 137, coingeckoId: 'matic-network' },
      ],
      { ethereum: { usd: 3000 }, 'matic-network': { usd: 0.5 } }
    );

    expect([...prices]).toEqual([
      [1, 3000],
      [137, 0.5],
    ]);
  });

  it('gives the same price to two chains sharing a coin', () => {
    const prices = toPriceMap(
      [
        { chainId: 1, coingeckoId: 'ethereum' },
        { chainId: 8453, coingeckoId: 'ethereum' },
      ],
      { ethereum: { usd: 3000 } }
    );

    expect(prices.get(8453)).toBe(3000);
  });

  it('leaves a chain with no coin id unpriced', () => {
    expect(toPriceMap([{ chainId: 31337 }], { ethereum: { usd: 3000 } }).get(31337)).toBeNull();
  });

  it('leaves a chain unpriced when the response omits its coin', () => {
    expect(toPriceMap([{ chainId: 1, coingeckoId: 'ethereum' }], {}).get(1)).toBeNull();
  });

  it('leaves every chain unpriced when there was no response at all', () => {
    expect(toPriceMap([{ chainId: 1, coingeckoId: 'ethereum' }], null).get(1)).toBeNull();
  });

  it('rejects a price that is not a finite number', () => {
    const prices = toPriceMap([{ chainId: 1, coingeckoId: 'ethereum' }], {
      ethereum: { usd: Number.NaN },
    });

    expect(prices.get(1)).toBeNull();
  });

  it('keeps a zero price, which is a price', () => {
    expect(
      toPriceMap([{ chainId: 1, coingeckoId: 'ethereum' }], { ethereum: { usd: 0 } }).get(1)
    ).toBe(0);
  });

  it('has an entry for every chain asked about, so a lookup never misses', () => {
    const prices = toPriceMap([{ chainId: 1 }, { chainId: 137 }], null);

    expect([...prices.keys()]).toEqual([1, 137]);
  });
});
