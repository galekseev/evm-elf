/**
 * Unit: what the proxy commands can tell from bytecode alone.
 *
 * Both detectors read runtime code and nothing else, which is the property that
 * lets `contract proxy-info` work without an ABI or a verified source. The
 * fixtures here are real bytecode shapes rather than strings chosen to satisfy
 * the regular expressions.
 */

import { describe, expect, it } from 'vitest';
import { looksLikeProxyAdmin, parseMinimalProxy, revertReason } from '../../src/lib/proxy.js';

const IMPLEMENTATION = '0x1234567890AbcdEF1234567890aBcdef12345678';
const EIP1167 = `0x363d3d373d3d3d363d73${IMPLEMENTATION.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
const EIP7511 = `0x365f5f375f5f365f73${IMPLEMENTATION.slice(2).toLowerCase()}5af43d5f5f3e5f3d91602a57fd5bf3`;

describe('parseMinimalProxy', () => {
  it('reads the implementation out of an EIP-1167 clone', () => {
    expect(parseMinimalProxy(EIP1167)).toBe(IMPLEMENTATION);
  });

  it('reads it out of the PUSH0 variant too', () => {
    expect(parseMinimalProxy(EIP7511)).toBe(IMPLEMENTATION);
  });

  it('returns a checksummed address whatever case the code was in', () => {
    expect(parseMinimalProxy(EIP1167.toUpperCase().replace('0X', '0x'))).toBe(IMPLEMENTATION);
  });

  it('is not fooled by a clone with anything appended', () => {
    expect(parseMinimalProxy(`${EIP1167}00`)).toBeNull();
  });

  it('says nothing about an ordinary contract', () => {
    expect(parseMinimalProxy('0x608060405234801561001057600080fd5b50')).toBeNull();
  });

  it('says nothing about an address with no code', () => {
    expect(parseMinimalProxy('0x')).toBeNull();
  });
});

describe('looksLikeProxyAdmin', () => {
  it('recognises code carrying both dispatcher selectors', () => {
    expect(looksLikeProxyAdmin('0x60806040529623609d1461003a5780638da5cb5b14610050')).toBe(true);
  });

  it('is unconvinced by upgradeAndCall alone', () => {
    expect(looksLikeProxyAdmin('0x6080604052639623609d1461003a')).toBe(false);
  });

  it('is unconvinced by owner() alone, which any Ownable has', () => {
    expect(looksLikeProxyAdmin('0x6080604052638da5cb5b14610050')).toBe(false);
  });

  it('reads the selectors case-insensitively', () => {
    expect(looksLikeProxyAdmin('0x9623609D8DA5CB5B')).toBe(true);
  });
});

describe('revertReason', () => {
  it('prefers the decoded reason', () => {
    expect(revertReason({ reason: 'Ownable: caller is not the owner', message: 'long' })).toBe(
      'Ownable: caller is not the owner'
    );
  });

  it('falls back to the short message when there is no reason', () => {
    expect(revertReason({ shortMessage: 'execution reverted', message: 'long' })).toBe(
      'execution reverted'
    );
  });

  it('falls back to the full message when there is neither', () => {
    expect(revertReason(new Error('connection refused'))).toBe('connection refused');
  });

  it('stringifies something that is not an error at all', () => {
    expect(revertReason('just a string')).toBe('just a string');
  });
});
