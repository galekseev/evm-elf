/**
 * Integration: what the four signing commands do without --exec.
 *
 * The property under test is the one that makes the CLI safe to run: a plan
 * reads the chain, simulates the write, and broadcasts nothing. So every test
 * here also asserts what the node was *not* asked — no eth_sendRawTransaction
 * reached the stub — because a plan that quietly sent something would still
 * print a plausible plan.
 */

import { describe, expect, test } from 'vitest';
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
  const stub = await startRpcStub(t, { chainId: 8453, ...options });
  await runner.write(
    'config/profiles/default.yaml',
    `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    symbol: ETH\n`
  );
  return { runner, stub };
}

describe('wallet send without --exec', () => {
  test('reports what it would send, in the chain’s own token', async (t) => {
    const { runner, stub } = await oneChain(t);

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--value', '0.25', '--private-key', SIGNER.key,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('would send 0.25');
    expect(result.stdout).toContain('ETH');
    expect(stub.methods()).not.toContain('eth_sendRawTransaction');
  });

  test('accepts the three amount forms and reads them as the same value', async (t) => {
    const { runner } = await oneChain(t);
    const plan = async (value: string): Promise<string> => {
      const result = await runner.invoke([
        'wallet', 'send', SOME_ADDRESS, '--value', value, '--private-key', SIGNER.key, '--json',
      ]);
      return (JSON.parse(result.stdout) as SendResult[])[0].value;
    };

    expect(await plan('0.01')).toBe('10000000000000000');
    expect(await plan('0.01ether')).toBe('10000000000000000');
    expect(await plan('10000000000000000wei')).toBe('10000000000000000');
  });

  test('does not read balances for a fixed --value, so an unfunded address still plans', async (t) => {
    const { runner, stub } = await oneChain(t, { balanceWei: 0n });

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--value', '1', '--private-key', SIGNER.key, '--json',
    ]);

    expect((JSON.parse(result.stdout) as SendResult[])[0].valueEth).toBe('1.0');
    expect(stub.methods()).not.toContain('eth_getBalance');
  });

  test('three identical plans send nothing and write nothing', async (t) => {
    const { runner, stub } = await oneChain(t);
    const args = ['wallet', 'send', SOME_ADDRESS, '--value', '0.1', '--private-key', SIGNER.key, '--json'];

    const outputs = [
      await runner.invoke(args),
      await runner.invoke(args),
      await runner.invoke(args),
    ];

    expect(new Set(outputs.map((output) => output.stdout)).size).toBe(1);
    expect(stub.methods()).not.toContain('eth_sendRawTransaction');
    expect(await runner.list('config/profiles')).toEqual(['default.yaml']);
  });

  test('--all skips a chain that cannot cover its own gas reserve', async (t) => {
    const { runner } = await oneChain(t, {
      balanceWei: 1n,
      handlers: { eth_estimateGas: () => '0x5208' },
    });

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--all', '--private-key', SIGNER.key, '--json',
    ]);

    expect(result.code).toBe(0);
    expect((JSON.parse(result.stdout) as SendResult[])[0].skipped).toContain('balance too low');
  });

  test('--all plans the balance minus a reserve the fee cannot exceed', async (t) => {
    const { runner } = await oneChain(t, {
      balanceWei: 1_000_000_000_000_000_000n,
      handlers: { eth_estimateGas: () => '0x5208' },
    });

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--all', '--private-key', SIGNER.key, '--json',
    ]);

    const [row] = JSON.parse(result.stdout) as SendResult[];
    expect(BigInt(row.value)).toBeLessThan(1_000_000_000_000_000_000n);
    expect(BigInt(row.value)).toBeGreaterThan(999_000_000_000_000_000n);
  });

  test('--all skips a chain with nothing to sweep', async (t) => {
    const { runner } = await oneChain(t, { balanceWei: 0n });

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--all', '--private-key', SIGNER.key, '--json',
    ]);

    expect((JSON.parse(result.stdout) as SendResult[])[0].skipped).toBe('zero balance');
  });

  test('refuses a recipient it cannot parse', async (t) => {
    const { runner } = await oneChain(t);

    const result = await runner.invoke([
      'wallet', 'send', 'not-an-address', '--value', '1', '--private-key', SIGNER.key,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Invalid recipient address');
  });

  test('refuses to run without being told how much to send', async (t) => {
    const { runner } = await oneChain(t);

    const result = await runner.invoke(['wallet', 'send', SOME_ADDRESS, '--private-key', SIGNER.key]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--value <amount> or --all');
  });

  test('refuses --no-wait on a plan, which sends nothing to wait for', async (t) => {
    const { runner } = await oneChain(t);

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--value', '1', '--private-key', SIGNER.key, '--no-wait',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--no-wait has no effect without --exec');
  });

  test('refuses a fee buffer below one, which would underfund the reserve', async (t) => {
    const { runner } = await oneChain(t);

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--all', '--private-key', SIGNER.key, '--fee-buffer', '0.5',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('must be a number >= 1');
  });

  test('refuses a plan against a profile that names no chains', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'chains: {}\n');

    const result = await runner.invoke([
      'wallet', 'send', SOME_ADDRESS, '--value', '1', '--private-key', SIGNER.key,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No chains selected');
  });
});

describe('wallet set-nonce without --exec', () => {
  test('says how many transactions the alignment would need', async (t) => {
    const { runner, stub } = await oneChain(t, { transactionCount: 5 });

    const result = await runner.invoke([
      'wallet', 'set-nonce', '8', '--private-key', SIGNER.key, '--json',
    ]);

    expect((JSON.parse(result.stdout) as SetNonceResult[])[0]).toMatchObject({
      currentNonce: 5,
      targetNonce: 8,
      txsNeeded: 3,
    });
    expect(stub.methods()).not.toContain('eth_sendRawTransaction');
  });

  test('needs nothing when the wallet is already at the target', async (t) => {
    const { runner } = await oneChain(t, { transactionCount: 8 });

    const result = await runner.invoke([
      'wallet', 'set-nonce', '8', '--private-key', SIGNER.key, '--json',
    ]);

    expect((JSON.parse(result.stdout) as SetNonceResult[])[0].txsNeeded).toBe(0);
  });

  test('needs nothing when the wallet is already past it', async (t) => {
    const { runner } = await oneChain(t, { transactionCount: 12 });

    const result = await runner.invoke(['wallet', 'set-nonce', '8', '--private-key', SIGNER.key]);

    expect(result.stdout).toContain('skip (above target)');
  });

  test('refuses a target that is not a non-negative integer', async (t) => {
    const { runner } = await oneChain(t);

    const result = await runner.invoke([
      'wallet', 'set-nonce', 'twelve', '--private-key', SIGNER.key,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Target nonce must be a non-negative integer');
  });
});

describe('contract transfer-ownership without --exec', () => {
  const ownable = (owner: string, transferAnswer?: ReturnType<typeof reverts>): RpcStubOptions => ({
    accounts: {
      [PROXY]: {
        code: PLAIN_CODE,
        calls: {
          'owner()': returns.address(owner),
          ...(transferAnswer ? { 'transferOwnership(address)': transferAnswer } : {}),
        },
      },
    },
  });

  test('reports what it found and confirms the simulated call', async (t) => {
    const { runner, stub } = await oneChain(t, ownable(SIGNER.address));

    const result = await runner.invoke([
      'contract', 'transfer-ownership', PROXY, SOME_ADDRESS,
      '-c', 'base', '--private-key', SIGNER.key,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('(dry run)');
    expect(result.stdout).toContain('Static call succeeded');
    expect(stub.methods()).not.toContain('eth_sendRawTransaction');
  });

  test('warns that the signer does not own the contract, without stopping', async (t) => {
    const { runner } = await oneChain(t, ownable(OWNER));

    const result = await runner.invoke([
      'contract', 'transfer-ownership', PROXY, SOME_ADDRESS,
      '-c', 'base', '--private-key', SIGNER.key,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('signer is NOT the current owner');
  });

  test('reports a revert with its reason, and still exits successfully', async (t) => {
    const { runner } = await oneChain(
      t,
      ownable(OWNER, reverts('Ownable: caller is not the owner'))
    );

    const result = await runner.invoke([
      'contract', 'transfer-ownership', PROXY, SOME_ADDRESS,
      '-c', 'base', '--private-key', SIGNER.key,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Ownable: caller is not the owner');
  });

  test('refuses a selection naming two chains', async (t) => {
    const { runner } = await oneChain(t);

    const result = await runner.invoke([
      'contract', 'transfer-ownership', PROXY, SOME_ADDRESS,
      '-c', 'base,mainnet', '--private-key', SIGNER.key,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('requires exactly one chain');
  });

  test('fails on an address with no code rather than reporting an owner of nothing', async (t) => {
    const { runner } = await oneChain(t, { code: '0x' });

    const result = await runner.invoke([
      'contract', 'transfer-ownership', PROXY, SOME_ADDRESS,
      '-c', 'base', '--private-key', SIGNER.key,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no code at address');
  });
});

describe('contract proxy-upgrade without --exec', () => {
  test('finds the admin the operator did not type, and simulates the upgrade', async (t) => {
    const { runner, stub } = await oneChain(t, proxyAccounts('transparent'));

    const result = await runner.invoke([
      'contract', 'proxy-upgrade', PROXY, IMPLEMENTATION,
      '-c', 'base', '--private-key', SIGNER.key, '--json',
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      proxyAdmin: ADMIN,
      adminOwner: OWNER,
      dryRun: true,
    });
    expect(stub.methods()).not.toContain('eth_sendRawTransaction');
  });

  test('refuses an address that is not the kind of proxy it upgrades', async (t) => {
    const { runner } = await oneChain(t, proxyAccounts('uups'));

    const result = await runner.invoke([
      'contract', 'proxy-upgrade', PROXY, IMPLEMENTATION,
      '-c', 'base', '--private-key', SIGNER.key,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('admin slot is empty');
  });

  test('refuses calldata that is not a 0x-prefixed hex string', async (t) => {
    const { runner } = await oneChain(t, proxyAccounts('transparent'));

    const result = await runner.invoke([
      'contract', 'proxy-upgrade', PROXY, IMPLEMENTATION,
      '-c', 'base', '--private-key', SIGNER.key, '--data', 'initialize()',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('must be a 0x-prefixed hex string');
  });
});
