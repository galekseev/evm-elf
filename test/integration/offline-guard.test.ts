/**
 * Integration: the guard that keeps the in-process layers off the internet.
 *
 * Worth its own file because it is the assumption every other test in these two
 * layers rests on. If it stopped working, nothing would fail — the suite would
 * just start reaching real services and passing for the wrong reason.
 */

import http from 'node:http';
import { describe, expect, test } from 'vitest';
import { SOME_ADDRESS } from '../helpers/cli.js';
import { createRunner } from '../helpers/inprocess.js';
import { startRpcStub } from '../helpers/rpc-stub.js';

describe('outbound requests', () => {
  test('fetch to a public host is refused, naming what it tried to reach', async () => {
    await expect(fetch('https://api.coingecko.com/api/v3/simple/price')).rejects.toThrow(
      /Blocked a request to https:\/\/api\.coingecko\.com/
    );
  });

  test('the same holds for the http module, which is how ethers reaches an RPC', () => {
    expect(() => http.request('http://api.etherscan.io/v2/api')).toThrow(/Blocked a request/);
    expect(() => http.request({ hostname: 'api.etherscan.io', path: '/' })).toThrow(
      /Blocked a request/
    );
  });

  test('loopback is allowed, which is where the stubs live', async (t) => {
    const stub = await startRpcStub(t);

    const response = await fetch(stub.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });

    expect(response.ok).toBe(true);
  });
});

describe('a command that would reach a public service', () => {
  test('degrades to an unpriced balance instead of reaching CoinGecko', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t, { chainId: 8453 });
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    coingecko_id: ethereum\n`
    );

    const result = await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--json']);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)[0].valueUsd).toBeUndefined();
  });
});
