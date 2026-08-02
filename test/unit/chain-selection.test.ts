/**
 * Unit: which chains a command touches, and what it can say about each.
 *
 * `resolveChain` is the function that must never throw — a fan-out command
 * reports a chain it cannot describe as a row rather than as a failed run — so
 * every shape of broken entry is asked of it here.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RpcProfile } from '../../src/types.js';
import { buildEndpoint, parseChainList, resolveChain, selectChains } from '../../src/lib/chains.js';

function profile(chains: RpcProfile['chains'], name = 'work'): RpcProfile {
  return { name, path: `/tmp/${name}.yaml`, chains, explorers: {} };
}

describe('parseChainList', () => {
  it('splits on commas', () => {
    expect(parseChainList('base,mainnet')).toEqual(['base', 'mainnet']);
  });

  it('trims the spaces a human leaves after a comma', () => {
    expect(parseChainList('base, mainnet ,  optimistic')).toEqual([
      'base',
      'mainnet',
      'optimistic',
    ]);
  });

  it('drops empty entries rather than passing an empty name on', () => {
    expect(parseChainList('base,,mainnet,')).toEqual(['base', 'mainnet']);
  });

  it('reads an empty string as no chains', () => {
    expect(parseChainList('')).toEqual([]);
  });
});

describe('selectChains', () => {
  const three = profile({ base: {}, mainnet: {}, optimistic: {} });

  it('uses every chain the profile names when nothing narrows it', () => {
    expect(selectChains(undefined, undefined, three)).toEqual(['base', 'mainnet', 'optimistic']);
  });

  it('takes the filter as given, in the order it was given', () => {
    expect(selectChains('mainnet,base', undefined, three)).toEqual(['mainnet', 'base']);
  });

  it('lets the filter name a chain the profile does not, so the row can say so', () => {
    expect(selectChains('nowhere', undefined, three)).toEqual(['nowhere']);
  });

  it('subtracts the excluded chains from the profile list', () => {
    expect(selectChains(undefined, 'mainnet', three)).toEqual(['base', 'optimistic']);
  });

  it('ignores an exclusion when a filter was given, since the filter is explicit', () => {
    expect(selectChains('base,mainnet', 'mainnet', three)).toEqual(['base', 'mainnet']);
  });

  it('warns on standard error about excluding a chain the profile never had', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(selectChains(undefined, 'nowhere', three)).toEqual(['base', 'mainnet', 'optimistic']);
    expect(stderr).toHaveBeenCalledWith(
      "Warning: excluded chain 'nowhere' is not in profile 'work'"
    );
  });

  it('says nothing when every excluded chain was there', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    selectChains(undefined, 'base', three);

    expect(stderr).not.toHaveBeenCalled();
  });
});

describe('resolveChain', () => {
  it('resolves a complete entry to an endpoint and its metadata', () => {
    const resolved = resolveChain(
      'base',
      profile({
        base: {
          chain_id: 8453,
          rpc_url: 'https://base.example/rpc',
          symbol: 'ETH',
          coingecko_id: 'ethereum',
          explorer_api: 'https://api.basescan.example/api',
        },
      })
    );

    expect(resolved).toEqual({
      chain: 'base',
      chainId: 8453,
      endpoint: { url: 'https://base.example/rpc' },
      symbol: 'ETH',
      coingeckoId: 'ethereum',
      explorerApi: 'https://api.basescan.example/api',
    });
  });

  it('reports a chain the profile does not name, and how to add it', () => {
    const resolved = resolveChain('nowhere', profile({ base: {} }));

    expect(resolved.endpoint).toBeNull();
    expect(resolved.chainId).toBe(0);
    expect(resolved.error).toBe("Not in profile 'work' (evm chain set nowhere <rpc-url>)");
  });

  it('reports a missing chain_id while keeping the metadata it does have', () => {
    const resolved = resolveChain(
      'base',
      profile({ base: { rpc_url: 'https://base.example/rpc', symbol: 'ETH' } })
    );

    expect(resolved.error).toBe('No chain_id set (evm chain set base <rpc-url>)');
    expect(resolved.symbol).toBe('ETH');
  });

  it('reports a missing rpc_url but still knows the chain id', () => {
    const resolved = resolveChain('base', profile({ base: { chain_id: 8453 } }));

    expect(resolved.chainId).toBe(8453);
    expect(resolved.endpoint).toBeNull();
    expect(resolved.error).toBe('No RPC URL configured (evm chain set base <rpc-url>)');
  });

  it('carries a malformed URL through as an error rather than throwing', () => {
    const resolved = resolveChain(
      'base',
      profile({ base: { chain_id: 8453, rpc_url: 'https://base.example|a|b' } })
    );

    expect(resolved.endpoint).toBeNull();
    expect(resolved.error).toContain('Invalid RPC URL');
  });

  it('carries an unresolvable ${VAR} through as an error on that chain alone', () => {
    vi.stubEnv('NOT_SET_ANYWHERE', undefined);

    const resolved = resolveChain(
      'base',
      profile({ base: { chain_id: 8453, rpc_url: '${NOT_SET_ANYWHERE}' } })
    );

    expect(resolved.error).toBe('Environment variable NOT_SET_ANYWHERE not set');
  });
});

describe('buildEndpoint', () => {
  it('resolves references in the URL and in every header', () => {
    vi.stubEnv('RPC_HOST', 'base.example');
    vi.stubEnv('RPC_KEY', 's3cret');

    expect(buildEndpoint('https://${RPC_HOST}/rpc', { 'auth-key': '${RPC_KEY}' })).toEqual({
      url: 'https://base.example/rpc',
      headers: { 'auth-key': 's3cret' },
    });
  });

  it('resolves a reference before the pipe is split, so a key may live in one', () => {
    vi.stubEnv('WHOLE_URL', 'https://base.example/rpc|s3cret');

    expect(buildEndpoint('${WHOLE_URL}')).toEqual({
      url: 'https://base.example/rpc',
      headers: { 'auth-key': 's3cret' },
    });
  });

  it('throws when a referenced variable is unset', () => {
    vi.stubEnv('MISSING_RPC', undefined);

    expect(() => buildEndpoint('${MISSING_RPC}')).toThrow(
      'Environment variable MISSING_RPC not set'
    );
  });
});
