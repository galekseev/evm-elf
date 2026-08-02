/**
 * Integration: the read commands of the `wallet` group against a chain.
 *
 * The chain is a loopback JSON-RPC server, so the ethers provider, the header
 * forwarding and the fan-out are all real. CoinGecko is the exception — its
 * address is compiled in and cannot be pointed at loopback — so the price
 * boundary is replaced by a fetch stub and every test says which of the two it
 * is exercising.
 */

import { describe, expect, test } from 'vitest';
import type { BalanceResult } from '../../src/types.js';
import { KEYS, SOME_ADDRESS } from '../helpers/cli.js';
import { COINGECKO, stubExternalHttp } from '../helpers/external-http.js';
import { createRunner } from '../helpers/inprocess.js';
import { REFUSED_URL, startRpcStub } from '../helpers/rpc-stub.js';

function profileWith(chains: Record<string, Record<string, string | number>>): string {
  const body = Object.entries(chains)
    .map(([name, fields]) =>
      [`  ${name}:`, ...Object.entries(fields).map(([key, value]) => `    ${key}: ${value}`)].join('\n')
    )
    .join('\n');
  return `chains:\n${body}\n`;
}

describe('wallet balance', () => {
  test('reports the balance, the pending nonce and a status per chain', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t, {
      chainId: 8453,
      balanceWei: 2_500_000_000_000_000_000n,
      transactionCount: 7,
    });
    await runner.write(
      'config/profiles/default.yaml',
      profileWith({ base: { chain_id: 8453, rpc_url: stub.url, symbol: 'ETH' } })
    );

    const result = await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--no-usd', '--json']);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      {
        chain: 'base',
        chainId: 8453,
        address: SOME_ADDRESS,
        balance: '2500000000000000000',
        balanceEth: '2.5',
        nonce: 7,
        symbol: 'ETH',
      },
    ]);
  });

  test('--no-usd issues no price request at all', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t);
    const external = stubExternalHttp({});
    await runner.write(
      'config/profiles/default.yaml',
      profileWith({ base: { chain_id: 8453, rpc_url: stub.url, coingecko_id: 'ethereum' } })
    );

    await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--no-usd', '--json']);

    expect(external.urls()).toEqual([]);
  });

  test('values the balance when the price source answers', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t, { balanceWei: 2_000_000_000_000_000_000n });
    stubExternalHttp({ [COINGECKO]: () => ({ ethereum: { usd: 3000 } }) });
    await runner.write(
      'config/profiles/default.yaml',
      profileWith({
        base: { chain_id: 8453, rpc_url: stub.url, symbol: 'ETH', coingecko_id: 'ethereum' },
      })
    );

    const result = await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--json']);

    const [row] = JSON.parse(result.stdout) as BalanceResult[];
    expect(row.priceUsd).toBe(3000);
    expect(row.valueUsd).toBe(6000);
  });

  test('sends the CoinGecko key as a demo key when the variable is set', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t);
    const external = stubExternalHttp({ [COINGECKO]: () => ({ ethereum: { usd: 1 } }) });
    await runner.write(
      'config/profiles/default.yaml',
      profileWith({ base: { chain_id: 8453, rpc_url: stub.url, coingecko_id: 'ethereum' } })
    );

    await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--json'], {
      env: { COINGECKO_API_KEY: 'demo-key' },
    });

    expect(external.requests[0].headers['x-cg-demo-api-key']).toBe('demo-key');
  });

  test('an unreachable price service does not cost the operator their balances', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t, { balanceWei: 1_000_000_000_000_000_000n });
    stubExternalHttp({
      [COINGECKO]: () => {
        throw new Error('the price service is down');
      },
    });
    await runner.write(
      'config/profiles/default.yaml',
      profileWith({ base: { chain_id: 8453, rpc_url: stub.url, coingecko_id: 'ethereum' } })
    );

    const result = await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--json']);

    expect(result.code).toBe(0);
    const [row] = JSON.parse(result.stdout) as BalanceResult[];
    expect(row.balanceEth).toBe('1.0');
    expect(row.valueUsd).toBeUndefined();
  });

  test('a chain with no coingecko_id is unpriced while its neighbour is not', async (t) => {
    const runner = await createRunner(t);
    const priced = await startRpcStub(t, { chainId: 8453 });
    const unpriced = await startRpcStub(t, { chainId: 31_337 });
    stubExternalHttp({ [COINGECKO]: () => ({ ethereum: { usd: 3000 } }) });
    await runner.write(
      'config/profiles/default.yaml',
      profileWith({
        base: { chain_id: 8453, rpc_url: priced.url, coingecko_id: 'ethereum' },
        local: { chain_id: 31_337, rpc_url: unpriced.url },
      })
    );

    const rows = JSON.parse(
      (await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--json'])).stdout
    ) as BalanceResult[];

    expect(rows[0].valueUsd).toBeGreaterThan(0);
    expect(rows[1].valueUsd).toBeUndefined();
  });

  test('one unreachable endpoint leaves the other chain intact and the run successful', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t, { chainId: 8453 });
    await runner.write(
      'config/profiles/default.yaml',
      profileWith({
        base: { chain_id: 8453, rpc_url: stub.url },
        dead: { chain_id: 1, rpc_url: REFUSED_URL },
      })
    );

    const result = await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--no-usd', '--json']);

    expect(result.code).toBe(0);
    const rows = JSON.parse(result.stdout) as BalanceResult[];
    expect(rows[0].error).toBeUndefined();
    expect(rows[1].error).toBeTruthy();
  });

  test('a selected chain the profile does not define becomes a row naming the fix', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', profileWith({ base: { chain_id: 8453 } }));

    const result = await runner.invoke([
      'wallet', 'balance', SOME_ADDRESS, '-c', 'nowhere', '--no-usd', '--json',
    ]);

    expect(result.code).toBe(0);
    const [row] = JSON.parse(result.stdout) as BalanceResult[];
    expect(row.error).toContain('evm chain set nowhere <rpc-url>');
  });

  test('configured headers reach the endpoint on every request', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t);
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    headers:\n      auth-key: \${BASE_KEY}\n`
    );

    await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--no-usd', '--json'], {
      env: { BASE_KEY: 'from-the-environment' },
    });

    expect(stub.calls.length).toBeGreaterThan(0);
    for (const call of stub.calls) {
      expect(call.headers['auth-key']).toBe('from-the-environment');
    }
  });

  test('takes a private key and reports the address it derived, never the key', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t);
    await runner.write(
      'config/profiles/default.yaml',
      profileWith({ base: { chain_id: 8453, rpc_url: stub.url } })
    );

    const result = await runner.invoke(['wallet', 'balance', KEYS.one.key, '--no-usd', '--json']);

    expect(result.stdout).toContain(KEYS.one.address);
    expect(result.stdout).not.toContain(KEYS.one.key);
  });

  test('refuses an argument that is none of the three forms', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['wallet', 'balance', 'not-a-wallet']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'Not an address, a private key, or a set environment variable: not-a-wallet'
    );
  });

  test('an unset ${VAR} fails one chain and leaves the others alone', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t, { chainId: 8453 });
    await runner.write(
      'config/profiles/default.yaml',
      profileWith({
        base: { chain_id: 8453, rpc_url: stub.url },
        referenced: { chain_id: 1, rpc_url: '${NOT_SET_ANYWHERE}' },
      })
    );

    const rows = JSON.parse(
      (await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--no-usd', '--json'])).stdout
    ) as BalanceResult[];

    expect(rows[0].error).toBeUndefined();
    expect(rows[1].error).toBe('Environment variable NOT_SET_ANYWHERE not set');
  });
});

describe('wallet address and generate', () => {
  test('derives the address from a key held in the environment', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['wallet', 'address', 'DEPLOYER_PK', '--json'], {
      env: { DEPLOYER_PK: KEYS.two.key },
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ address: KEYS.two.address });
  });

  test('carries only the address, never the key it came from', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['wallet', 'address', KEYS.two.key, '--json']);

    expect(result.stdout).not.toContain(KEYS.two.key);
  });

  test('prints the bare address in the human form, and nothing else', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['wallet', 'address', KEYS.two.key]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(KEYS.two.address);
  });

  test('refuses a name that is neither a key nor a set variable', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['wallet', 'address', 'NOT_SET_ANYWHERE']);

    expect(result.code).toBe(1);
    // The message names the argument rather than the option, because on this
    // command the key is the argument.
    expect(result.stderr).toContain(
      'key argument is neither a hex key nor a set environment variable: NOT_SET_ANYWHERE'
    );
    expect(result.stdout).toBe('');
  });

  test('generates a wallet of the requested mnemonic length', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['wallet', 'generate', '--words', '24', '--json']);

    const wallet = JSON.parse(result.stdout) as { mnemonic: string; address: string };
    expect(wallet.mnemonic.split(' ')).toHaveLength(24);
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test('generates a different wallet each time, and stores neither', async (t) => {
    const runner = await createRunner(t);

    const first = JSON.parse((await runner.invoke(['wallet', 'generate', '--json'])).stdout);
    const second = JSON.parse((await runner.invoke(['wallet', 'generate', '--json'])).stdout);

    expect(first.address).not.toBe(second.address);
    expect(await runner.tree('config')).toEqual([]);
  });

  test('refuses a mnemonic length that is neither 12 nor 24', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['wallet', 'generate', '--words', '18']);

    expect(result.code).toBe(1);
  });
});
