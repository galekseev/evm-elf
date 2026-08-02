/**
 * Characterization: the paths that only run once a chain answers.
 *
 * A JSON-RPC stub on 127.0.0.1 stands in for a node, which keeps the suite
 * offline while still exercising chain-id detection, header forwarding, a
 * populated balance row and price-source selection. Every `wallet balance` here
 * names a price source explicitly, because the default one is CoinGecko and a
 * test suite has no business reaching for it.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { KEYS, SOME_ADDRESS, createWorkspace, parseJson, row } from '../helpers/cli.js';
import { startRpcStub } from '../helpers/rpc-stub.js';

interface BalanceRow {
  chain: string;
  chainId: number;
  address: string;
  balance: string;
  balanceEth: string;
  nonce: number;
  symbol?: string;
  valueUsd?: number;
  error?: string;
}

describe('chain set against a live endpoint', () => {
  // REQ-051, REQ-054
  test('the chain id is read from the endpoint and metadata comes from the bundle', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.run(['profile', 'create', 'work', '--empty']);
    const stub = await startRpcStub(t, { chainId: 8453 });

    const result = await workspace.run(['chain', 'set', 'base-backup', stub.url, '-p', 'work']);

    assert.equal(result.code, 0);
    assert.equal(
      result.stdout,
      `Added base-backup to ${workspace.profilesDir}/work.yaml\n` +
        '  chain_id     8453\n' +
        `  rpc_url      ${stub.url}\n` +
        '  symbol       ETH\n' +
        '  coingecko_id ethereum\n'
    );
    assert.ok(stub.methods().includes('eth_chainId'));
    assert.match(await workspace.read('config/profiles/work.yaml'), /chain_id: 8453/);
  });

  // REQ-052
  test('a --chain-id the endpoint disagrees with aborts the write', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', 'chains: {}\n');
    const stub = await startRpcStub(t, { chainId: 8453 });

    const result = await workspace.run([
      'chain', 'set', 'base', stub.url, '--chain-id', '137', '-p', 'work',
    ]);

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `Chain id mismatch: ${stub.url} reports 8453, expected 137. Nothing written.\n`
    );
    assert.equal(await workspace.read('config/profiles/work.yaml'), 'chains: {}\n');
  });

  // REQ-018: <URL>|<AUTH_KEY> becomes an auth-key header on every request
  test('the second RPC URL form sends an auth-key header', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', 'chains: {}\n');
    const stub = await startRpcStub(t);

    const result = await workspace.run([
      'chain', 'set', 'base', `${stub.url}|secret-key`, '-p', 'work',
    ]);

    assert.equal(result.code, 0);
    assert.equal(stub.calls[0].headers['auth-key'], 'secret-key');
    assert.match(await workspace.read('config/profiles/work.yaml'), /rpc_url: .*\|secret-key/);
  });

  // REQ-053: with --no-verify the endpoint is never contacted
  test('--no-verify with --chain-id makes no request at all', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', 'chains: {}\n');
    const stub = await startRpcStub(t);

    const result = await workspace.run([
      'chain', 'set', 'base', stub.url, '--chain-id', '999', '--no-verify', '-p', 'work',
    ]);

    assert.equal(result.code, 0);
    assert.deepEqual(stub.calls, []);
    assert.match(await workspace.read('config/profiles/work.yaml'), /chain_id: 999/);
  });
});

describe('requests a read sends', () => {
  // REQ-017: the provider is pinned to the configured chain id, so a read never
  // asks the endpoint which network it is
  test('a fan-out read does not ask for the chain id', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t);
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    symbol: ETH\n`
    );

    await workspace.run(['wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--no-usd']);

    assert.deepEqual(new Set(stub.methods()), new Set(['eth_getBalance', 'eth_getTransactionCount']));
  });

  // REQ-017, REQ-031: configured headers are attached, with references resolved
  test('configured headers ride on every request, with ${VAR} resolved', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t);
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n` +
        '    headers:\n      x-literal: plain\n      x-ref: "${SOME_TOKEN}"\n'
    );

    const result = await workspace.run(
      ['wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--no-usd'],
      { env: { SOME_TOKEN: 'resolved-value' } }
    );

    assert.equal(result.code, 0);
    assert.ok(stub.calls.length > 0);
    for (const call of stub.calls) {
      assert.equal(call.headers['x-literal'], 'plain');
      assert.equal(call.headers['x-ref'], 'resolved-value');
    }
  });

  // REQ-081: the nonce column is the pending transaction count
  test('the nonce is asked for at the pending block', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t);
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n`
    );

    await workspace.run(['wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--no-usd']);

    const nonceCall = stub.calls.find((call) => call.method === 'eth_getTransactionCount');
    assert.deepEqual(nonceCall?.params, [SOME_ADDRESS.toLowerCase(), 'pending']);
  });
});

describe('a chain that answers', () => {
  // REQ-080
  test('wallet balance fills the row and reports OK', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, {
      chainId: 8453,
      balanceWei: 1_500_000_000_000_000_000n,
      transactionCount: 7,
    });
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    symbol: ETH\n`
    );

    const table = await workspace.run([
      'wallet', 'balance', KEYS.one.address, '-p', 'work', '--no-usd',
    ]);

    assert.equal(table.code, 0);
    assert.ok(table.stdout.includes(`Wallet Balance: ${KEYS.one.address}`));
    const solo = row(table.stdout, 'solo');
    assert.ok(solo?.startsWith('solo            8453       1.5'), solo);
    assert.ok(solo?.endsWith('OK'), solo);

    const json = await workspace.run([
      'wallet', 'balance', KEYS.one.address, '-p', 'work', '--no-usd', '--json',
    ]);
    assert.deepEqual(parseJson<BalanceRow[]>(json.stdout), [
      {
        chain: 'solo',
        chainId: 8453,
        address: KEYS.one.address,
        balance: '1500000000000000000',
        balanceEth: '1.5',
        nonce: 7,
        symbol: 'ETH',
      },
    ]);
  });

  // REQ-004: --json without the USD column, and the table without it either
  test('--no-usd removes the USD column from the table', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t);
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n`
    );

    const result = await workspace.run([
      'wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--no-usd',
    ]);

    assert.ok(!result.stdout.includes('Value (USD)'), result.stdout);
    assert.ok(result.stdout.includes('Nonce'));
  });

  test('contract code reports a deployed contract and an empty address', async (t) => {
    const workspace = await createWorkspace(t);
    const deployed = await startRpcStub(t, { code: '0x6080604052' });
    const empty = await startRpcStub(t, { code: '0x' });
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  full:\n    chain_id: 8453\n    rpc_url: ${deployed.url}\n` +
        `  bare:\n    chain_id: 8453\n    rpc_url: ${empty.url}\n`
    );

    const result = await workspace.run([
      'contract', 'code', SOME_ADDRESS, '-p', 'work', '--json',
    ]);

    assert.equal(result.code, 0);
    assert.deepEqual(parseJson(result.stdout), [
      { chain: 'full', chainId: 8453, address: SOME_ADDRESS, codeSize: 5, deployed: true },
      { chain: 'bare', chainId: 8453, address: SOME_ADDRESS, codeSize: 0, deployed: false },
    ]);
  });
});

describe('price source selection', () => {
  // REQ-126: the warning is raised where the source is selected, which is only
  // reached once at least one chain answered
  test('an unrecognised EVM_PRICE_SOURCE warns on stderr and leaves --json parseable', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t);
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n` +
        '    symbol: ETH\n    coingecko_id: ethereum\n'
    );

    const result = await workspace.run(['wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--json'], {
      env: { EVM_PRICE_SOURCE: 'nonsense' },
    });

    assert.equal(result.code, 0);
    assert.equal(
      result.stderr,
      "Warning: unknown price source 'nonsense', using 'none' (valid: coingecko, none)\n"
    );
    const rows = parseJson<BalanceRow[]>(result.stdout);
    assert.equal(rows[0].valueUsd, undefined);
  });

  // REQ-125
  test('EVM_PRICE_SOURCE=none is silent and prices nothing', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t);
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n` +
        '    symbol: ETH\n    coingecko_id: ethereum\n'
    );

    const result = await workspace.run(['wallet', 'balance', SOME_ADDRESS, '-p', 'work'], {
      env: { EVM_PRICE_SOURCE: 'none' },
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('Value (USD)'), 'the column is still there');
    assert.ok(row(result.stdout, 'solo')?.includes('-'), row(result.stdout, 'solo'));
  });

  // REQ-126: a run with nothing to price stays quiet, however odd the value
  test('an unrecognised source stays quiet when every chain failed', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/work.yaml',
      'chains:\n  solo:\n    chain_id: 8453\n    rpc_url: http://127.0.0.1:1\n'
    );

    const result = await workspace.run(['wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--json'], {
      env: { EVM_PRICE_SOURCE: 'nonsense' },
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
  });
});
