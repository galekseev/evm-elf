/**
 * Unit: the `<URL>|<AUTH_KEY>` shorthand a profile may hold in `rpc_url`.
 *
 * This is the one place a typo turns an endpoint into a different endpoint, so
 * both what it accepts and what it refuses are pinned here rather than left to
 * a command test to notice.
 */

import { describe, expect, it } from 'vitest';
import { parseRpcUrl } from '../../src/lib/rpc.js';

describe('parseRpcUrl', () => {
  it('returns a bare URL with no headers', () => {
    expect(parseRpcUrl('https://base.example/rpc')).toEqual({ url: 'https://base.example/rpc' });
  });

  it('turns the part after the pipe into an auth-key header', () => {
    expect(parseRpcUrl('https://base.example/rpc|s3cret')).toEqual({
      url: 'https://base.example/rpc',
      headers: { 'auth-key': 's3cret' },
    });
  });

  it('merges configured headers with the one the pipe supplies', () => {
    expect(parseRpcUrl('https://base.example/rpc|s3cret', { 'x-trace': 'on' })).toEqual({
      url: 'https://base.example/rpc',
      headers: { 'x-trace': 'on', 'auth-key': 's3cret' },
    });
  });

  it('lets the pipe win over an auth-key that was configured as a header', () => {
    expect(parseRpcUrl('https://base.example/rpc|from-pipe', { 'auth-key': 'from-headers' })).toEqual(
      { url: 'https://base.example/rpc', headers: { 'auth-key': 'from-pipe' } }
    );
  });

  it('keeps configured headers when there is no pipe', () => {
    expect(parseRpcUrl('https://base.example/rpc', { 'x-trace': 'on' })).toEqual({
      url: 'https://base.example/rpc',
      headers: { 'x-trace': 'on' },
    });
  });

  it('omits headers entirely rather than returning an empty object', () => {
    expect(parseRpcUrl('https://base.example/rpc', {})).not.toHaveProperty('headers');
  });

  it('refuses a second pipe, which would silently drop a key', () => {
    expect(() => parseRpcUrl('https://base.example/rpc|one|two')).toThrow(
      'Invalid RPC URL: expected <URL> or <URL>|<AUTH_KEY>, got: https://base.example/rpc|one|two'
    );
  });

  it('refuses a value that is only a pipe and a key', () => {
    expect(() => parseRpcUrl('|s3cret')).toThrow('Invalid RPC URL');
  });

  it('refuses an empty value', () => {
    expect(() => parseRpcUrl('')).toThrow('Invalid RPC URL');
  });

  it('treats a trailing pipe as no key rather than as an empty one', () => {
    expect(parseRpcUrl('https://base.example/rpc|')).toEqual({ url: 'https://base.example/rpc' });
  });
});
