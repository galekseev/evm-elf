/**
 * Unit: choosing a price source.
 *
 * The interesting rule is what an unrecognised name does. Falling back to
 * CoinGecko would reach the network for someone who set the variable precisely
 * to stop that, so it falls back to 'none' instead — and says so on standard
 * error, where it cannot corrupt --json.
 */

import { describe, expect, it, vi } from 'vitest';
import { resolvePriceSource } from '../../src/lib/prices/index.js';

describe('resolvePriceSource', () => {
  it('uses CoinGecko when nothing is set', () => {
    vi.stubEnv('EVM_PRICE_SOURCE', undefined);

    expect(resolvePriceSource().name).toBe('coingecko');
  });

  it('honours an explicit argument over the environment', () => {
    vi.stubEnv('EVM_PRICE_SOURCE', 'coingecko');

    expect(resolvePriceSource('none').name).toBe('none');
  });

  it('reads the name case-insensitively', () => {
    expect(resolvePriceSource('CoinGecko').name).toBe('coingecko');
    expect(resolvePriceSource('NONE').name).toBe('none');
  });

  it('takes the name from $EVM_PRICE_SOURCE', () => {
    vi.stubEnv('EVM_PRICE_SOURCE', 'none');

    expect(resolvePriceSource().name).toBe('none');
  });

  it('falls back to none for an unknown name rather than to the network', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(resolvePriceSource('off').name).toBe('none');
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("unknown price source 'off'"));
  });

  it('says nothing at all for a recognised name', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    resolvePriceSource('none');

    expect(stderr).not.toHaveBeenCalled();
  });

  it('prices nothing when the source is none, whatever it is asked', async () => {
    const prices = await resolvePriceSource('none').getNativeUsdPrices([
      { chainId: 1, coingeckoId: 'ethereum' },
    ]);

    expect(prices.size).toBe(0);
  });

  it('asks for no price when no chain has a coin id, and still answers for each', async () => {
    const prices = await resolvePriceSource('coingecko').getNativeUsdPrices([
      { chainId: 31_337 },
      { chainId: 1337 },
    ]);

    expect([...prices]).toEqual([
      [31_337, null],
      [1337, null],
    ]);
  });
});
