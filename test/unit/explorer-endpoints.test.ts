/**
 * Unit: the ordered list of explorer endpoints a chain is served by.
 *
 * The order is the behaviour — a chain's own `explorer_api` is tried before the
 * shared sources — and so is the omission: a source whose key does not resolve
 * is left out here rather than failing on the wire.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  EXPLORER_NAMES,
  explorerBaseUrl,
  isExplorerName,
  resolveEndpoints,
} from '../../src/lib/explorer/index.js';

const BASE = { chain: 'base', chainId: 8453 };

describe('isExplorerName', () => {
  it('accepts the two known sources', () => {
    expect(EXPLORER_NAMES.every(isExplorerName)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isExplorerName('etherscan-v1')).toBe(false);
  });
});

describe('explorerBaseUrl', () => {
  it('gives the multichain endpoint for each source', () => {
    expect(explorerBaseUrl('etherscan')).toBe('https://api.etherscan.io/v2/api');
    expect(explorerBaseUrl('blockscout')).toBe('https://api.blockscout.com/v2/api');
  });
});

describe('resolveEndpoints', () => {
  it('has nothing to try when nothing is configured', () => {
    expect(resolveEndpoints(undefined, BASE)).toEqual([]);
  });

  it("puts the chain's own explorer_api first, with no key and no chainid", () => {
    vi.stubEnv('ETHERSCAN_API_KEY', 'from-env');

    const endpoints = resolveEndpoints(
      { etherscan: '${ETHERSCAN_API_KEY}' },
      { ...BASE, explorerApi: 'https://api.basescan.example/api' }
    );

    expect(endpoints).toEqual([
      { source: 'base', baseUrl: 'https://api.basescan.example/api' },
      {
        source: 'etherscan',
        baseUrl: 'https://api.etherscan.io/v2/api',
        apiKey: 'from-env',
        chainId: 8453,
      },
    ]);
  });

  it('orders the shared sources as EXPLORER_NAMES does', () => {
    const endpoints = resolveEndpoints({ blockscout: 'b', etherscan: 'e' }, BASE);

    expect(endpoints.map((endpoint) => endpoint.source)).toEqual([...EXPLORER_NAMES]);
  });

  it('leaves out a source whose reference does not resolve', () => {
    vi.stubEnv('ETHERSCAN_API_KEY', undefined);

    const endpoints = resolveEndpoints(
      { etherscan: '${ETHERSCAN_API_KEY}', blockscout: 'literal' },
      BASE
    );

    expect(endpoints.map((endpoint) => endpoint.source)).toEqual(['blockscout']);
  });

  it('leaves out a source configured with an empty key', () => {
    expect(resolveEndpoints({ etherscan: '' }, BASE)).toEqual([]);
  });

  it('passes the chain id along, since one endpoint serves every chain', () => {
    const [endpoint] = resolveEndpoints({ etherscan: 'key' }, { chain: 'zksync', chainId: 324 });

    expect(endpoint.chainId).toBe(324);
  });
});
