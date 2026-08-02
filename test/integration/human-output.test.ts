/**
 * Integration: the tables an operator actually reads.
 *
 * The `--json` path is easy to assert and easy to over-test; the rendered
 * output is where the decisions live — what a sub-cent balance rounds to, which
 * chains are left out of a total, whether two chains are running the same
 * build. Those are behaviours, not formatting, and they are only visible here.
 */

import { describe, expect, test } from 'vitest';
import { KEYS, SOME_ADDRESS, lines, row } from '../helpers/cli.js';
import { COINGECKO, stubExternalHttp } from '../helpers/external-http.js';
import { createRunner, type Runner } from '../helpers/inprocess.js';
import {
  IMPLEMENTATION,
  IMPLEMENTATION_CODE,
  PLAIN_CODE,
  PROXY,
  REFUSED_URL,
  proxyAccounts,
  returns,
  startRpcStub,
  type RpcStubOptions,
} from '../helpers/rpc-stub.js';

const SIGNER = KEYS.one;

async function oneChain(
  t: Parameters<typeof createRunner>[0],
  options: RpcStubOptions = {}
): Promise<Runner> {
  const runner = await createRunner(t);
  const stub = await startRpcStub(t, { chainId: 8453, ...options });
  await runner.write(
    'config/profiles/default.yaml',
    `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    symbol: ETH\n    coingecko_id: ethereum\n`
  );
  return runner;
}

describe('the balance table', () => {
  test('names the wallet, one row per chain, and a total in USD', async (t) => {
    const runner = await oneChain(t, { balanceWei: 2_000_000_000_000_000_000n });
    stubExternalHttp({ [COINGECKO]: () => ({ ethereum: { usd: 1500 } }) });

    const result = await runner.invoke(['wallet', 'balance', SOME_ADDRESS]);

    expect(result.stdout).toContain(`Wallet Balance: ${SOME_ADDRESS}`);
    expect(row(result.stdout, 'base')).toContain('2.0');
    expect(result.stdout).toContain('$3,000.00');
    expect(result.stdout).toContain('Total');
  });

  test('a balance worth less than a cent is not rounded away', async (t) => {
    const runner = await oneChain(t, { balanceWei: 1_000_000_000_000n });
    stubExternalHttp({ [COINGECKO]: () => ({ ethereum: { usd: 1 } }) });

    const result = await runner.invoke(['wallet', 'balance', SOME_ADDRESS]);

    expect(result.stdout).toContain('<$0.01');
  });

  test('an unpriced chain holding a balance is named and left out of the total', async (t) => {
    const runner = await createRunner(t);
    const priced = await startRpcStub(t, { chainId: 8453, balanceWei: 1_000_000_000_000_000_000n });
    const unpriced = await startRpcStub(t, {
      chainId: 31_337,
      balanceWei: 5_000_000_000_000_000_000n,
    });
    stubExternalHttp({ [COINGECKO]: () => ({ ethereum: { usd: 100 } }) });
    await runner.write(
      'config/profiles/default.yaml',
      [
        'chains:',
        '  base:',
        '    chain_id: 8453',
        `    rpc_url: ${priced.url}`,
        '    coingecko_id: ethereum',
        '  local:',
        '    chain_id: 31337',
        `    rpc_url: ${unpriced.url}`,
        '',
      ].join('\n')
    );

    const result = await runner.invoke(['wallet', 'balance', SOME_ADDRESS]);

    expect(result.stdout).toContain('$100.00');
    expect(result.stdout).toContain('No price for: local (excluded from total)');
  });

  test('a failed chain gets a row with the reason and dashes for the numbers', async (t) => {
    const runner = await createRunner(t);
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  dead:\n    chain_id: 1\n    rpc_url: ${REFUSED_URL}\n`
    );

    const result = await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--no-usd']);

    const dead = row(result.stdout, 'dead');
    expect(dead).toBeDefined();
    expect(dead).toContain('-');
    expect(result.stdout).not.toContain('Total');
  });

  test('--no-usd drops the value column entirely', async (t) => {
    const runner = await oneChain(t);

    const withUsd = await runner.invoke(['wallet', 'balance', SOME_ADDRESS]);
    const without = await runner.invoke(['wallet', 'balance', SOME_ADDRESS, '--no-usd']);

    expect(withUsd.stdout).toContain('Value (USD)');
    expect(without.stdout).not.toContain('Value (USD)');
  });
});

describe('the code and owner tables', () => {
  test('code reports a size in bytes and whether the address holds any', async (t) => {
    const runner = await oneChain(t, { accounts: { [PROXY]: { code: PLAIN_CODE } } });

    const result = await runner.invoke(['contract', 'code', PROXY]);

    expect(row(result.stdout, 'base')).toContain('17 B');
    expect(row(result.stdout, 'base')).toContain('deployed');
  });

  test('an address with no code prints 0 B and no hex block', async (t) => {
    const runner = await oneChain(t, { code: '0x' });

    const result = await runner.invoke(['contract', 'code', SOME_ADDRESS, '-c', 'base', '--full']);

    expect(result.stdout).toContain('0 B');
    expect(result.stdout).not.toContain(PLAIN_CODE);
  });

  test('--full prints the bytecode under the table', async (t) => {
    const runner = await oneChain(t, { accounts: { [PROXY]: { code: PLAIN_CODE } } });

    const result = await runner.invoke(['contract', 'code', PROXY, '-c', 'base', '--full']);

    expect(result.stdout).toContain(PLAIN_CODE);
  });

  test('owner prints one owner per chain', async (t) => {
    const runner = await oneChain(t, {
      accounts: {
        [PROXY]: { code: PLAIN_CODE, calls: { 'owner()': returns.address(SIGNER.address) } },
      },
    });

    const result = await runner.invoke(['contract', 'owner', PROXY]);

    expect(row(result.stdout, 'base')).toContain(SIGNER.address);
  });

  test('owner prints the reason for a contract that has none', async (t) => {
    const runner = await oneChain(t, { accounts: { [PROXY]: { code: PLAIN_CODE } } });

    const result = await runner.invoke(['contract', 'owner', PROXY]);

    expect(result.code).toBe(0);
    expect(lines(result.stdout).length).toBeGreaterThan(2);
  });
});

describe('the proxy-info tables', () => {
  test('the short form is one labelled row per chain', async (t) => {
    const runner = await oneChain(t, proxyAccounts('transparent'));

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '-s']);

    expect(result.stdout).toContain('Proxy type');
    expect(row(result.stdout, 'base')).toContain('transparent proxy');
  });

  test('the short form labels an address that is no proxy at all', async (t) => {
    const runner = await oneChain(t, proxyAccounts('none'));

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '-s']);

    expect(row(result.stdout, 'base')).toMatch(/not a proxy|none/i);
  });

  test('the normal form names the implementation and the admin it found', async (t) => {
    const runner = await oneChain(t, proxyAccounts('transparent'));

    const result = await runner.invoke(['contract', 'proxy-info', PROXY]);

    expect(result.stdout).toContain('Implementation:');
    expect(result.stdout).toContain('Proxy admin:');
    expect(result.stdout).toContain(IMPLEMENTATION);
  });

  test('--full names the balance in the chain’s own token', async (t) => {
    const runner = await oneChain(
      t,
      proxyAccounts('transparent', { balanceWei: 3_000_000_000_000_000_000n })
    );

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '--full']);

    expect(result.stdout).toContain('3.0 ETH');
  });

  test('--full says when two chains are running the same build', async (t) => {
    const runner = await createRunner(t);
    const first = await startRpcStub(t, { chainId: 8453, ...proxyAccounts('transparent') });
    const second = await startRpcStub(t, { chainId: 1, ...proxyAccounts('transparent') });
    await runner.write(
      'config/profiles/default.yaml',
      [
        'chains:',
        `  base:\n    chain_id: 8453\n    rpc_url: ${first.url}`,
        `  mainnet:\n    chain_id: 1\n    rpc_url: ${second.url}`,
        '',
      ].join('\n')
    );

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '--full']);

    expect(result.stdout).toContain('identical on all 2 chains');
  });

  test('--full says when they are not', async (t) => {
    const runner = await createRunner(t);
    const first = await startRpcStub(t, { chainId: 8453, ...proxyAccounts('transparent') });
    const second = await startRpcStub(t, {
      chainId: 1,
      ...proxyAccounts('transparent', { implementationCode: `${IMPLEMENTATION_CODE}00` }),
    });
    await runner.write(
      'config/profiles/default.yaml',
      [
        'chains:',
        `  base:\n    chain_id: 8453\n    rpc_url: ${first.url}`,
        `  mainnet:\n    chain_id: 1\n    rpc_url: ${second.url}`,
        '',
      ].join('\n')
    );

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '--full']);

    expect(result.stdout).toContain('DIFFERS across chains (2 variants)');
  });

  test('a single chain has nothing to compare, so it says nothing', async (t) => {
    const runner = await oneChain(t, proxyAccounts('transparent'));

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '--full']);

    expect(result.stdout).not.toContain('identical on all');
    expect(result.stdout).not.toContain('DIFFERS');
  });

  test('--full reports a pending owner and a paused contract when it finds them', async (t) => {
    const runner = await oneChain(
      t,
      proxyAccounts('transparent', { pendingOwner: SIGNER.address, paused: true })
    );

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '--full']);

    expect(result.stdout).toContain(SIGNER.address);
    expect(result.stdout.toLowerCase()).toContain('paused');
  });
});

describe('the plan tables', () => {
  test('set-nonce names the target and how many transactions it needs', async (t) => {
    const runner = await oneChain(t, { transactionCount: 5 });

    const result = await runner.invoke(['wallet', 'set-nonce', '8', '--private-key', SIGNER.key]);

    expect(result.stdout).toContain(`→ target 8`);
    expect(result.stdout).toContain('(plan only');
    expect(row(result.stdout, 'base')).toContain('will send');
  });

  test('set-nonce says a chain is already at the target', async (t) => {
    const runner = await oneChain(t, { transactionCount: 8 });

    const result = await runner.invoke(['wallet', 'set-nonce', '8', '--private-key', SIGNER.key]);

    expect(result.stdout).toContain('skip (already at target)');
  });

  test('set-nonce reports a failed chain in its own row', async (t) => {
    const runner = await createRunner(t);
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  dead:\n    chain_id: 1\n    rpc_url: ${REFUSED_URL}\n`
    );

    const result = await runner.invoke(['wallet', 'set-nonce', '8', '--private-key', SIGNER.key]);

    expect(result.code).toBe(1);
    expect(row(result.stdout, 'dead')).toBeDefined();
  });

  test('send names the sweep mode and its fee buffer in the header', async (t) => {
    const runner = await oneChain(t, { balanceWei: 1_000_000_000_000_000_000n });

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--all', '--fee-buffer', '1.5', '--private-key', SIGNER.key,
    ]);

    expect(result.stdout).toContain('sweep entire balance (fee buffer x1.5)');
  });

  test('send prints a skip row for a chain it left alone', async (t) => {
    const runner = await oneChain(t, { balanceWei: 0n });

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--all', '--private-key', SIGNER.key,
    ]);

    expect(row(result.stdout, 'base')).toContain('skip (zero balance)');
  });

  test('send reports a failed chain and exits 1 when every chain failed', async (t) => {
    const runner = await createRunner(t);
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  dead:\n    chain_id: 1\n    rpc_url: ${REFUSED_URL}\n`
    );

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--all', '--private-key', SIGNER.key,
    ]);

    expect(result.code).toBe(1);
    expect(row(result.stdout, 'dead')).toBeDefined();
  });
});

describe('the wallet generate output', () => {
  test('prints the mnemonic, the key and the address, and warns they are shown once', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['wallet', 'generate']);

    expect(result.stdout).toContain('Mnemonic:');
    expect(result.stdout).toContain('Private key:');
    expect(result.stdout).toContain('Address:');
    expect(result.stdout.toLowerCase()).toContain('once');
  });
});

describe('the chain and profile tables', () => {
  test('an empty profile says how to add a chain', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'chains: {}\n');

    const result = await runner.invoke(['chain', 'list']);

    expect(result.stdout).toContain('evm chain set base <rpc-url>');
  });

  test('a chain list renders what is missing rather than failing', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'chains:\n  half:\n    chain_id: 8453\n');

    const result = await runner.invoke(['chain', 'list']);

    expect(result.code).toBe(0);
    expect(row(result.stdout, 'half')).toContain('not set');
  });

  test('an empty profiles directory says how to create one', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/.default', 'ghost\n');

    const result = await runner.invoke(['profile', 'list']);

    expect(result.stdout).toContain('evm profile create');
  });

  test('a profile that cannot be parsed is listed with its error', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/broken.yaml', 'chains:\n  base:\n    chain_id: nope\n');
    await runner.write('config/profiles/.default', 'broken\n');

    const result = await runner.invoke(['profile', 'list']);

    expect(result.stdout).toContain('error');
    expect(result.stdout).toContain('non-numeric chain_id');
  });
});
