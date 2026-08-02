/**
 * The in-process layers may not reach the internet.
 *
 * Unit tests should make no request at all, and integration tests point the
 * code under test at loopback stubs. Without a guard the difference between
 * "the stub answered" and "api.etherscan.io answered" is invisible in a green
 * run, and a suite that quietly depends on a third party fails on the day that
 * party is slow.
 *
 * Both request paths are covered: `fetch`, which the explorer and price clients
 * use, and `http`/`https`, which ethers uses for JSON-RPC.
 */

import http from 'node:http';
import https from 'node:https';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);

function refuse(target: string): never {
  throw new Error(
    `Blocked a request to ${target}: in-process tests may only talk to loopback. ` +
      'Point the code under test at a stub server, or move the test to the acceptance layer.'
  );
}

function checkHost(host: string | undefined, target: string): void {
  if (host !== undefined && !LOOPBACK.has(host.replace(/^\[|\]$/g, ''))) {
    refuse(target);
  }
}

function hostOf(target: unknown): string | undefined {
  if (target instanceof URL) {
    return target.hostname;
  }
  if (typeof target === 'string') {
    try {
      return new URL(target).hostname;
    } catch {
      refuse(target);
    }
  }
  if (target !== null && typeof target === 'object') {
    const options = target as { hostname?: string; host?: string };
    return (options.hostname ?? options.host)?.replace(/:\d+$/, '');
  }
  return undefined;
}

type FetchInput = Parameters<typeof fetch>[0];

const realFetch = globalThis.fetch;
// Async, so a blocked call rejects the way a failed request would rather than
// throwing where the caller does not expect it.
globalThis.fetch = async function guardedFetch(input: unknown, init?: RequestInit) {
  const target =
    input instanceof URL || typeof input === 'string' ? input : (input as { url: string }).url;
  checkHost(hostOf(target), String(target));
  return realFetch(input as FetchInput, init);
} as typeof fetch;

type RequestFn = typeof http.request;

function guard(original: RequestFn): RequestFn {
  return function guarded(this: unknown, ...args: unknown[]) {
    checkHost(hostOf(args[0]), String(args[0]));
    return (original as (...rest: unknown[]) => http.ClientRequest).apply(this, args);
  } as unknown as RequestFn;
}

http.request = guard(http.request);
http.get = guard(http.get);
https.request = guard(https.request);
https.get = guard(https.get);
