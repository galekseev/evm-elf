/**
 * Unit: the YAML document editor behind every profile write.
 *
 * These functions take a parsed document and hand one back, which is what makes
 * them testable without a filesystem — and what makes the comment-preservation
 * promise checkable at all, since a parse/stringify cycle would lose it
 * silently.
 */

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import {
  getChain,
  getExplorers,
  listChains,
  removeChain,
  removeExplorer,
  setChain,
  setExplorer,
} from '../../src/lib/profile-file.js';

const TWO_CHAINS = [
  '# the profile the deploy scripts read',
  '',
  'chains:',
  '  base:',
  '    chain_id: 8453',
  '    rpc_url: https://base.example/rpc',
  '  # the one nobody touches',
  '  mainnet:',
  '    chain_id: 1',
  '    rpc_url: https://mainnet.example/rpc',
  '',
].join('\n');

describe('reading a document', () => {
  it('lists the chains in file order', () => {
    expect(listChains(parseDocument(TWO_CHAINS))).toEqual(['base', 'mainnet']);
  });

  it('returns one chain as plain values', () => {
    expect(getChain(parseDocument(TWO_CHAINS), 'base')).toEqual({
      chain_id: 8453,
      rpc_url: 'https://base.example/rpc',
    });
  });

  it('returns undefined for a chain that is not there', () => {
    expect(getChain(parseDocument(TWO_CHAINS), 'nowhere')).toBeUndefined();
  });

  it('reads the pre-0.2 shorthand as an entry carrying only the URL', () => {
    const doc = parseDocument('chains:\n  base: https://base.example/rpc\n');

    expect(getChain(doc, 'base')).toEqual({ rpc_url: 'https://base.example/rpc' });
  });
});

describe('setChain', () => {
  it('adds a new entry with the fields in a fixed order', () => {
    const doc = parseDocument('chains: {}\n');

    setChain(doc, 'base', {
      coingecko_id: 'ethereum',
      chain_id: 8453,
      symbol: 'ETH',
      rpc_url: 'https://base.example/rpc',
    });

    expect(Object.keys(getChain(doc, 'base') ?? {})).toEqual([
      'chain_id',
      'rpc_url',
      'symbol',
      'coingecko_id',
    ]);
  });

  it('edits an existing entry in place, leaving the comments around it', () => {
    const doc = parseDocument(TWO_CHAINS);

    setChain(doc, 'base', { rpc_url: 'https://new.example/rpc' });

    const written = doc.toString({ lineWidth: 0 });
    expect(written).toContain('# the profile the deploy scripts read');
    expect(written).toContain('# the one nobody touches');
    expect(written).toContain('rpc_url: https://new.example/rpc');
    expect(written).not.toContain('https://base.example/rpc');
  });

  it('clears a field set to null', () => {
    const doc = parseDocument('chains:\n  base:\n    chain_id: 8453\n    symbol: ETH\n');

    setChain(doc, 'base', { symbol: null });

    expect(getChain(doc, 'base')).toEqual({ chain_id: 8453 });
  });

  it('reads an empty string as clearing the field too', () => {
    const doc = parseDocument('chains:\n  base:\n    chain_id: 8453\n    symbol: ETH\n');

    setChain(doc, 'base', { symbol: '' });

    expect(getChain(doc, 'base')).toEqual({ chain_id: 8453 });
  });

  it('merges headers into the ones already there', () => {
    const doc = parseDocument(
      'chains:\n  base:\n    chain_id: 8453\n    headers:\n      auth-key: old\n'
    );

    setChain(doc, 'base', { headers: { 'x-trace': 'on' } });

    expect(getChain(doc, 'base')?.headers).toEqual({ 'auth-key': 'old', 'x-trace': 'on' });
  });

  it('removes a named header and drops the mapping when it was the last one', () => {
    const doc = parseDocument(
      'chains:\n  base:\n    chain_id: 8453\n    headers:\n      auth-key: old\n'
    );

    setChain(doc, 'base', { removeHeaders: ['auth-key'] });

    expect(getChain(doc, 'base')).toEqual({ chain_id: 8453 });
  });

  it('replaces a shorthand entry with a full mapping', () => {
    const doc = parseDocument('chains:\n  base: https://base.example/rpc\n');

    setChain(doc, 'base', { chain_id: 8453, rpc_url: 'https://base.example/rpc' });

    expect(getChain(doc, 'base')).toEqual({
      chain_id: 8453,
      rpc_url: 'https://base.example/rpc',
    });
  });
});

describe('removeChain', () => {
  it('reports that it removed one', () => {
    const doc = parseDocument(TWO_CHAINS);

    expect(removeChain(doc, 'base')).toBe(true);
    expect(listChains(doc)).toEqual(['mainnet']);
  });

  it('reports that there was nothing to remove', () => {
    const doc = parseDocument(TWO_CHAINS);

    expect(removeChain(doc, 'nowhere')).toBe(false);
    expect(listChains(doc)).toEqual(['base', 'mainnet']);
  });
});

describe('the explorers section', () => {
  it('is empty when the file has none', () => {
    expect(getExplorers(parseDocument(TWO_CHAINS))).toEqual({});
  });

  it('is created above chains, where two lines can be read without scrolling', () => {
    const doc = parseDocument(TWO_CHAINS);

    setExplorer(doc, 'etherscan', '${ETHERSCAN_API_KEY}');

    const written = doc.toString({ lineWidth: 0 });
    expect(written.indexOf('explorers:')).toBeLessThan(written.indexOf('chains:'));
  });

  it('leaves the document header above it', () => {
    const doc = parseDocument(TWO_CHAINS);

    setExplorer(doc, 'etherscan', 'key');

    expect(doc.toString({ lineWidth: 0 })).toMatch(/^# the profile the deploy scripts read/);
  });

  it('reads back what was set', () => {
    const doc = parseDocument(TWO_CHAINS);

    setExplorer(doc, 'etherscan', '${ETHERSCAN_API_KEY}');
    setExplorer(doc, 'blockscout', 'literal-key');

    expect(getExplorers(doc)).toEqual({
      etherscan: '${ETHERSCAN_API_KEY}',
      blockscout: 'literal-key',
    });
  });

  it('leaves a reference unresolved, because the file is what it says it is', () => {
    const doc = parseDocument('explorers:\n  etherscan: ${ETHERSCAN_API_KEY}\nchains: {}\n');

    expect(getExplorers(doc)).toEqual({ etherscan: '${ETHERSCAN_API_KEY}' });
  });

  it('omits an entry that is present but empty', () => {
    const doc = parseDocument("explorers:\n  etherscan: ''\nchains: {}\n");

    expect(getExplorers(doc)).toEqual({});
  });

  it('reports whether the removal found anything', () => {
    const doc = parseDocument('explorers:\n  etherscan: key\nchains: {}\n');

    expect(removeExplorer(doc, 'etherscan')).toBe(true);
    expect(removeExplorer(doc, 'etherscan')).toBe(false);
  });

  it('reports nothing removed when there is no section at all', () => {
    expect(removeExplorer(parseDocument(TWO_CHAINS), 'etherscan')).toBe(false);
  });

  it('refuses a document whose explorers key is not a mapping', () => {
    const doc = parseDocument('explorers: a-string\nchains: {}\n');

    expect(() => setExplorer(doc, 'etherscan', 'key')).toThrow(
      "Invalid profile: 'explorers' must be a mapping"
    );
  });
});
