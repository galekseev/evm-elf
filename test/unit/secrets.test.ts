/**
 * Unit: the two rules that decide whether a configured value reaches the
 * screen — masking, and what counts as a key at all.
 *
 * A mistake in either is a leaked API key or a leaked private key, so the cases
 * here are about the boundaries: a value short enough that its tail is the
 * whole thing, a reference that is not a secret, a variable holding something
 * that is.
 */

import { describe, expect, it, vi } from 'vitest';
import { maskValue } from '../../src/lib/mask.js';
import { resolveEnvRefs, tryResolveEnvRefs } from '../../src/lib/env.js';
import { deriveAddress, resolveAddress, resolvePrivateKey } from '../../src/lib/wallet.js';

const KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';
const ADDRESS = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

describe('maskValue', () => {
  it('shows the last four characters of a literal', () => {
    expect(maskValue('abcdefghij', false)).toBe('****ghij');
  });

  it('shows nothing at all of a value too short to have a tail', () => {
    expect(maskValue('abcd', false)).toBe('****');
  });

  it('shows a literal in full when asked to reveal', () => {
    expect(maskValue('abcdefghij', true)).toBe('abcdefghij');
  });

  it('prints a reference as written, because a reference is not a secret', () => {
    vi.stubEnv('SOME_KEY', 'live-value');

    expect(maskValue('${SOME_KEY}', false)).toBe('${SOME_KEY}');
  });

  it('marks a reference whose variable is unset, which is how a gap is spotted', () => {
    vi.stubEnv('SOME_KEY', undefined);

    expect(maskValue('${SOME_KEY}', false)).toBe('${SOME_KEY} (unset)');
  });

  it('reveals a reference no further than printing it, even when asked to', () => {
    vi.stubEnv('SOME_KEY', 'live-value');

    expect(maskValue('${SOME_KEY}', true)).toBe('${SOME_KEY}');
  });

  it('treats a value that merely contains a reference as a literal', () => {
    expect(maskValue('prefix-${SOME_KEY}', false)).toBe('****KEY}');
  });
});

describe('resolveEnvRefs', () => {
  it('substitutes a reference', () => {
    vi.stubEnv('RPC_HOST', 'base.example');

    expect(resolveEnvRefs('https://${RPC_HOST}/rpc')).toBe('https://base.example/rpc');
  });

  it('substitutes every reference in one value', () => {
    vi.stubEnv('HOST', 'base.example');
    vi.stubEnv('KEY', 's3cret');

    expect(resolveEnvRefs('https://${HOST}/${KEY}')).toBe('https://base.example/s3cret');
  });

  it('leaves a value with no references alone', () => {
    expect(resolveEnvRefs('https://base.example/rpc')).toBe('https://base.example/rpc');
  });

  it('names the variable it could not resolve', () => {
    vi.stubEnv('MISSING', undefined);

    expect(() => resolveEnvRefs('${MISSING}')).toThrow('Environment variable MISSING not set');
  });

  it('accepts a variable set to an empty string as set', () => {
    vi.stubEnv('EMPTY', '');

    expect(resolveEnvRefs('${EMPTY}')).toBe('');
  });
});

describe('tryResolveEnvRefs', () => {
  it('gives back the resolved value', () => {
    vi.stubEnv('KEY', 's3cret');

    expect(tryResolveEnvRefs('${KEY}')).toBe('s3cret');
  });

  it('gives back undefined for an unset variable rather than throwing', () => {
    vi.stubEnv('MISSING', undefined);

    expect(tryResolveEnvRefs('${MISSING}')).toBeUndefined();
  });

  it('reads a variable set to an empty string as nothing to use', () => {
    vi.stubEnv('EMPTY', '');

    expect(tryResolveEnvRefs('${EMPTY}')).toBeUndefined();
  });
});

describe('resolvePrivateKey', () => {
  it('accepts a 0x-prefixed hex key', () => {
    expect(resolvePrivateKey(KEY)).toBe(KEY);
  });

  it('adds the prefix to a bare hex key', () => {
    expect(resolvePrivateKey(KEY.slice(2))).toBe(KEY);
  });

  it('looks up anything that is not a key as a variable name', () => {
    vi.stubEnv('DEPLOYER_KEY', KEY);

    expect(resolvePrivateKey('DEPLOYER_KEY')).toBe(KEY);
  });

  it('uses a value shaped like a key as one, without consulting the environment', () => {
    vi.stubEnv(KEY, 'something else entirely');

    expect(resolvePrivateKey(KEY)).toBe(KEY);
  });

  it('refuses a name that is neither a key nor a set variable', () => {
    vi.stubEnv('NOT_SET', undefined);

    expect(() => resolvePrivateKey('NOT_SET')).toThrow(
      '--private-key is neither a hex key nor a set environment variable: NOT_SET'
    );
  });

  it('refuses a variable that is set but holds something else', () => {
    vi.stubEnv('DEPLOYER_KEY', 'not-a-key');

    expect(() => resolvePrivateKey('DEPLOYER_KEY')).toThrow(
      'Private key must be a 32-byte hex string'
    );
  });

  it('refuses a hex string of the wrong length, naming it in the message', () => {
    vi.stubEnv('0xdeadbeef', undefined);

    expect(() => resolvePrivateKey('0xdeadbeef')).toThrow(
      '--private-key is neither a hex key nor a set environment variable: 0xdeadbeef'
    );
  });
});

describe('resolveAddress', () => {
  it('takes an address as given, checksummed', () => {
    expect(resolveAddress(ADDRESS.toLowerCase())).toBe(ADDRESS);
  });

  it('derives the address from a key rather than reporting the key', () => {
    expect(resolveAddress(KEY)).toBe(ADDRESS);
  });

  it('reads a variable holding an address', () => {
    vi.stubEnv('WALLET', ADDRESS);

    expect(resolveAddress('WALLET')).toBe(ADDRESS);
  });

  it('reads a variable holding a key, and derives from it', () => {
    vi.stubEnv('WALLET', KEY);

    expect(resolveAddress('WALLET')).toBe(ADDRESS);
  });

  it('names the argument when it is none of the three', () => {
    vi.stubEnv('NOT_SET', undefined);

    expect(() => resolveAddress('NOT_SET')).toThrow(
      'Not an address, a private key, or a set environment variable: NOT_SET'
    );
  });

  it('says so when the variable is set but holds neither', () => {
    vi.stubEnv('WALLET', 'neither');

    expect(() => resolveAddress('WALLET')).toThrow(
      'Env variable WALLET holds neither an address nor a 32-byte hex private key'
    );
  });
});

describe('deriveAddress', () => {
  it('derives the documented address for a known key', () => {
    expect(deriveAddress(KEY)).toBe(ADDRESS);
  });
});
