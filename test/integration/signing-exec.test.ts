/**
 * Integration: what --exec does, and what it refuses to do.
 *
 * The plan paths are covered next door; this is the other half — the one the
 * feature files mark as needing a broadcast. The stub accepts a signed
 * transaction and reports it mined, which is enough to reach the code after the
 * send: the receipt, the confirmation re-read, and the nonce poll.
 *
 * The refusals matter more than the successes. A simulation that reverts must
 * stop the broadcast, and the assertion for that is what the endpoint was never
 * asked.
 */

import { describe, expect, test } from 'vitest';
import { keccak256 } from 'ethers';
import type { SendResult, SetNonceResult } from '../../src/types.js';
import { KEYS, SOME_ADDRESS } from '../helpers/cli.js';
import { createRunner, type Runner } from '../helpers/inprocess.js';
import {
  ADMIN,
  IMPLEMENTATION,
  OWNER,
  PLAIN_CODE,
  PROXY,
  proxyAccounts,
  returns,
  reverts,
  startRpcStub,
  type RpcStub,
  type RpcStubOptions,
} from '../helpers/rpc-stub.js';

const SIGNER = KEYS.one;

async function oneChain(
  t: Parameters<typeof createRunner>[0],
  options: RpcStubOptions = {}
): Promise<{ runner: Runner; stub: RpcStub }> {
  const runner = await createRunner(t);
  const stub = await startRpcStub(t, { chainId: 8453, mineTransactions: true, ...options });
  await runner.write(
    'config/profiles/default.yaml',
    `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    symbol: ETH\n`
  );
  return { runner, stub };
}

describe('wallet send --exec', () => {
  test('broadcasts a signed transaction and reports the block it landed in', async (t) => {
    const { runner, stub } = await oneChain(t);

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--value', '0.01',
      '--private-key', SIGNER.key, '--exec', '--json',
    ]);

    expect(result.code).toBe(0);
    const [row] = JSON.parse(result.stdout) as SendResult[];
    expect(row.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(row.blockNumber).toBe(2);
    expect(stub.methods()).toContain('eth_sendRawTransaction');
  });

  test('--no-wait sends without waiting for a receipt', async (t) => {
    const { runner } = await oneChain(t);

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--value', '0.01',
      '--private-key', SIGNER.key, '--exec', '--no-wait', '--json',
    ]);

    const [row] = JSON.parse(result.stdout) as SendResult[];
    expect(row.txHash).toBeTruthy();
    expect(row.blockNumber).toBeUndefined();
  });

  test('sending twice sends twice, because --exec has no memory of the first run', async (t) => {
    const { runner, stub } = await oneChain(t);
    const args = [
      'wallet', 'send', SOME_ADDRESS, '--value', '0.01',
      '--private-key', SIGNER.key, '--exec', '--json',
    ];

    await runner.invoke(args);
    await runner.invoke(args);

    expect(stub.methods().filter((method) => method === 'eth_sendRawTransaction')).toHaveLength(2);
  });

  test('the raw transaction carries no key material', async (t) => {
    const { runner, stub } = await oneChain(t);

    await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--value', '0.01', '--private-key', SIGNER.key, '--exec',
    ]);

    const broadcast = stub.calls.find((call) => call.method === 'eth_sendRawTransaction');
    expect(JSON.stringify(broadcast?.params)).not.toContain(SIGNER.key.slice(2));
  });
});

describe('wallet set-nonce --exec', () => {
  test('sends one self-transaction per missing nonce and waits for the target', async (t) => {
    const runner = await createRunner(t);
    let nonce = 5;
    const stub = await startRpcStub(t, {
      chainId: 8453,
      mineTransactions: true,
      handlers: {
        eth_getTransactionCount: () => `0x${nonce.toString(16)}`,
        eth_sendRawTransaction: (params) => {
          nonce += 1;
          return keccak256(String(params[0]));
        },
      },
    });
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n`
    );

    const result = await runner.invoke([
      'wallet', 'set-nonce', '8', '--private-key', SIGNER.key, '--exec', '--json',
    ]);

    expect(result.code).toBe(0);
    expect((JSON.parse(result.stdout) as SetNonceResult[])[0]).toMatchObject({
      txsNeeded: 3,
      txsSent: 3,
      finalNonce: 8,
    });
  });

  test('re-running after a successful alignment sends nothing', async (t) => {
    const { runner, stub } = await oneChain(t, { transactionCount: 8 });

    const result = await runner.invoke([
      'wallet', 'set-nonce', '8', '--private-key', SIGNER.key, '--exec', '--json',
    ]);

    expect((JSON.parse(result.stdout) as SetNonceResult[])[0].txsNeeded).toBe(0);
    expect(stub.methods()).not.toContain('eth_sendRawTransaction');
  });
});

describe('contract transfer-ownership --exec', () => {
  test('confirms the transfer by re-reading the owner on chain', async (t) => {
    const { runner, stub } = await oneChain(t, {
      accounts: {
        [PROXY]: {
          code: PLAIN_CODE,
          calls: { 'owner()': returns.address(SIGNER.address) },
        },
      },
    });

    const result = await runner.invoke([
      'contract', 'transfer-ownership', PROXY, SOME_ADDRESS,
      '-c', 'base', '--private-key', SIGNER.key, '--exec', '--json',
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ dryRun: false, blockNumber: 2 });
    expect(stub.methods()).toContain('eth_sendRawTransaction');
  });

  test('a revert in simulation stops the broadcast', async (t) => {
    const { runner, stub } = await oneChain(t, {
      accounts: {
        [PROXY]: {
          code: PLAIN_CODE,
          calls: {
            'owner()': returns.address(OWNER),
            'transferOwnership(address)': reverts('Ownable: caller is not the owner'),
          },
        },
      },
    });

    const result = await runner.invoke([
      'contract', 'transfer-ownership', PROXY, SOME_ADDRESS,
      '-c', 'base', '--private-key', SIGNER.key, '--exec',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('static call reverted, not sending');
    expect(stub.methods()).not.toContain('eth_sendRawTransaction');
  });
});

describe('contract proxy-upgrade --exec', () => {
  test('sends through the ProxyAdmin and reads the implementation slot back', async (t) => {
    const { runner, stub } = await oneChain(t, proxyAccounts('transparent'));

    const result = await runner.invoke([
      'contract', 'proxy-upgrade', PROXY, IMPLEMENTATION,
      '-c', 'base', '--private-key', SIGNER.key, '--exec', '--json',
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      dryRun: false,
      proxyAdmin: ADMIN,
      finalImplementation: IMPLEMENTATION,
    });
    expect(stub.methods()).toContain('eth_sendRawTransaction');
  });

  test('not owning the ProxyAdmin does not block a send the simulation accepted', async (t) => {
    const { runner, stub } = await oneChain(t, proxyAccounts('transparent'));

    const result = await runner.invoke([
      'contract', 'proxy-upgrade', PROXY, IMPLEMENTATION,
      '-c', 'base', '--private-key', KEYS.two.key, '--exec', '--json',
    ]);

    expect(result.code).toBe(0);
    expect(stub.methods()).toContain('eth_sendRawTransaction');
  });
});
