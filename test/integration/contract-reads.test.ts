/**
 * Integration: the read commands of the `contract` group, and the explorer
 * fields that only appear when a source answers.
 *
 * Proxy detection is the part worth exercising against a real provider: it is
 * built out of storage reads, `eth_call`s that are meant to fail, and bytecode
 * matching, and a hand-written fake of the provider would decide the answer
 * rather than test it. The stub answers JSON-RPC and nothing more.
 */

import { describe, expect, test } from 'vitest';
import type { CodeResult, ContractOwnerResult, ProxyInfoResult } from '../../src/types.js';
import { UPGRADED_TOPIC } from '../../src/lib/proxy.js';
import { SOME_ADDRESS } from '../helpers/cli.js';
import { addressTopic, startExplorerStub } from '../helpers/explorer-stub.js';
import { createRunner } from '../helpers/inprocess.js';
import {
  ADMIN,
  BEACON,
  IMPLEMENTATION,
  IMPLEMENTATION_CODE,
  OWNER,
  PLAIN_CODE,
  PROXY,
  REFUSED_URL,
  codeHash,
  proxyAccounts,
  returns,
  startRpcStub,
  type RpcStubOptions,
} from '../helpers/rpc-stub.js';

async function oneChain(
  t: Parameters<typeof createRunner>[0],
  options: RpcStubOptions = {},
  extraFields = ''
): Promise<Awaited<ReturnType<typeof createRunner>>> {
  const runner = await createRunner(t);
  const stub = await startRpcStub(t, { chainId: 8453, ...options });
  await runner.write(
    'config/profiles/default.yaml',
    `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    symbol: ETH\n${extraFields}`
  );
  return runner;
}

describe('contract code', () => {
  test('reports the bytecode size and whether the address holds code', async (t) => {
    const runner = await oneChain(t, { accounts: { [PROXY]: { code: PLAIN_CODE } } });

    const result = await runner.invoke(['contract', 'code', PROXY, '--json']);

    expect(result.code).toBe(0);
    const [row] = JSON.parse(result.stdout) as CodeResult[];
    expect(row.deployed).toBe(true);
    expect(row.codeSize).toBe((PLAIN_CODE.length - 2) / 2);
  });

  test('an address with no code still carries a size of zero', async (t) => {
    const runner = await oneChain(t, { code: '0x' });

    const [row] = JSON.parse(
      (await runner.invoke(['contract', 'code', SOME_ADDRESS, '--json'])).stdout
    ) as CodeResult[];

    expect(row).toMatchObject({ deployed: false, codeSize: 0 });
  });

  test('--full carries the bytecode itself', async (t) => {
    const runner = await oneChain(t, { accounts: { [PROXY]: { code: PLAIN_CODE } } });

    const [row] = JSON.parse(
      (await runner.invoke(['contract', 'code', PROXY, '-c', 'base', '--full', '--json'])).stdout
    ) as CodeResult[];

    expect(row.code).toBe(PLAIN_CODE);
  });

  test('refuses --full when more than one chain would print it', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t);
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n  mainnet:\n    chain_id: 1\n    rpc_url: ${stub.url}\n`
    );

    const result = await runner.invoke(['contract', 'code', PROXY, '--full']);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
  });
});

describe('contract owner', () => {
  test('reads owner() and reports one owner per chain', async (t) => {
    const runner = await oneChain(t, {
      accounts: { [PROXY]: { code: PLAIN_CODE, calls: { 'owner()': returns.address(OWNER) } } },
    });

    const [row] = JSON.parse(
      (await runner.invoke(['contract', 'owner', PROXY, '--json'])).stdout
    ) as ContractOwnerResult[];

    expect(row.owner).toBe(OWNER);
  });

  test('a contract without owner() is reported per chain rather than as a failed run', async (t) => {
    const runner = await oneChain(t, { accounts: { [PROXY]: { code: PLAIN_CODE } } });

    const result = await runner.invoke(['contract', 'owner', PROXY, '--json']);

    expect(result.code).toBe(0);
    const [row] = JSON.parse(result.stdout) as ContractOwnerResult[];
    expect(row.owner).toBeUndefined();
    expect(row.error).toBeTruthy();
  });

  test('an unparseable address stops the command before any chain is touched', async (t) => {
    const runner = await oneChain(t);

    const result = await runner.invoke(['contract', 'owner', 'not-an-address']);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
  });
});

describe('contract proxy-info detection', () => {
  const SHAPES = [
    ['transparent', 'transparent'],
    ['uups', 'uups'],
    ['beacon', 'beacon'],
    ['minimal', 'minimal'],
    ['minimal-push0', 'minimal'],
    ['beacon-contract', 'beacon-contract'],
    ['proxy-admin', 'proxy-admin'],
    ['none', 'none'],
  ] as const;

  for (const [kind, expected] of SHAPES) {
    test(`classifies a ${kind} address as ${expected}`, async (t) => {
      const runner = await oneChain(t, proxyAccounts(kind));

      const [row] = JSON.parse(
        (await runner.invoke(['contract', 'proxy-info', PROXY, '-s', '--json'])).stdout
      ) as ProxyInfoResult[];

      expect(row.proxyType).toBe(expected);
    });
  }

  test('a transparent proxy reports its implementation and its admin', async (t) => {
    const runner = await oneChain(t, proxyAccounts('transparent'));

    const [row] = JSON.parse(
      (await runner.invoke(['contract', 'proxy-info', PROXY, '--json'])).stdout
    ) as ProxyInfoResult[];

    expect(row).toMatchObject({
      implementation: IMPLEMENTATION,
      admin: ADMIN,
      adminHasCode: true,
      adminOwner: OWNER,
    });
  });

  test('a beacon proxy reports the beacon and the implementation behind it', async (t) => {
    const runner = await oneChain(t, proxyAccounts('beacon'));

    const [row] = JSON.parse(
      (await runner.invoke(['contract', 'proxy-info', PROXY, '--json'])).stdout
    ) as ProxyInfoResult[];

    expect(row).toMatchObject({ beacon: BEACON, implementation: IMPLEMENTATION, beaconOwner: OWNER });
  });

  test('the short form skips the lookups the long form makes', async (t) => {
    const short = await oneChain(t, proxyAccounts('transparent'));
    await short.invoke(['contract', 'proxy-info', PROXY, '-s', '--json']);

    const [row] = JSON.parse(
      (await short.invoke(['contract', 'proxy-info', PROXY, '-s', '--json'])).stdout
    ) as ProxyInfoResult[];

    expect(row.proxyType).toBe('transparent');
    expect(row.adminOwner).toBeUndefined();
  });

  test('--full adds the code hash and the initialization it could read', async (t) => {
    const runner = await oneChain(t, proxyAccounts('transparent', { initializedV5: 1 }));

    const [row] = JSON.parse(
      (await runner.invoke(['contract', 'proxy-info', PROXY, '--full', '--json'])).stdout
    ) as ProxyInfoResult[];

    expect(row.implementationCodeHash).toBe(codeHash(IMPLEMENTATION_CODE));
    expect(row).toMatchObject({ initializedVersion: 1, initializableSource: 'oz-v5' });
  });

  test('a per-chain failure is data rather than a failed run', async (t) => {
    const runner = await createRunner(t);
    const stub = await startRpcStub(t, { chainId: 8453, ...proxyAccounts('transparent') });
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n  dead:\n    chain_id: 1\n    rpc_url: ${REFUSED_URL}\n`
    );

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '-s', '--json']);

    expect(result.code).toBe(0);
    const rows = JSON.parse(result.stdout) as ProxyInfoResult[];
    expect(rows[0].proxyType).toBe('transparent');
    expect(rows[1].error).toBeTruthy();
  });
});

describe('the explorer-backed fields', () => {
  test('appear when a source answers, and name the source that did', async (t) => {
    const runner = await createRunner(t);
    const explorer = await startExplorerStub(t, {
      accounts: {
        [IMPLEMENTATION]: { name: 'MyToken' },
        [PROXY]: { creation: { txHash: `0x${'11'.repeat(32)}`, creator: OWNER } },
      },
    });
    const stub = await startRpcStub(t, { chainId: 8453, ...proxyAccounts('transparent') });
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    explorer_api: ${explorer.url}\n`
    );

    const [row] = JSON.parse(
      (await runner.invoke(['contract', 'proxy-info', PROXY, '--full', '--json'])).stdout
    ) as ProxyInfoResult[];

    expect(row.implementationName).toBe('MyToken');
    expect(row.createdBy).toBe(OWNER);
    expect(row.explorerSource).toBe('base');
    expect(explorer.actions()).toContain('getsourcecode');
  });

  test('are absent when no source is configured, and the note on stderr explains why', async (t) => {
    const runner = await oneChain(t, proxyAccounts('transparent'));

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '--full', '--json']);

    const [row] = JSON.parse(result.stdout) as ProxyInfoResult[];
    expect(row.implementationName).toBeUndefined();
    expect(result.stderr).toContain('Skipped explorer lookups');
    expect(result.stderr).toContain('evm explorer set');
  });

  test('the note is a diagnostic, so --json stays parseable beside it', async (t) => {
    const runner = await oneChain(t, proxyAccounts('transparent'));

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '--full', '--json']);

    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  test('the short form wants no lookup, so it emits no note', async (t) => {
    const runner = await oneChain(t, proxyAccounts('transparent'));

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '-s']);

    expect(result.stderr).toBe('');
  });

  test('the upgrade history is read from the Upgraded events and dated', async (t) => {
    const runner = await createRunner(t);
    const explorer = await startExplorerStub(t, {
      accounts: {
        [PROXY]: {
          logs: {
            [UPGRADED_TOPIC.toLowerCase()]: [
              { topics: [UPGRADED_TOPIC, addressTopic(OWNER)], blockNumber: 10, timestamp: 1_700_000_000 },
              { topics: [UPGRADED_TOPIC, addressTopic(IMPLEMENTATION)], blockNumber: 20, timestamp: 1_800_000_000 },
            ],
          },
        },
      },
    });
    const stub = await startRpcStub(t, { chainId: 8453, ...proxyAccounts('transparent') });
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    explorer_api: ${explorer.url}\n`
    );

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '--full', '--json']);

    const [row] = JSON.parse(result.stdout) as ProxyInfoResult[];
    expect(row.upgradeHistory).toEqual([
      { implementation: OWNER.toLowerCase(), blockNumber: 10, timestamp: 1_700_000_000 },
      { implementation: IMPLEMENTATION.toLowerCase(), blockNumber: 20, timestamp: 1_800_000_000 },
    ]);
    expect(explorer.actions()).toContain('getLogs');
  });

  test('a proxy the explorer has no events for reports none recorded', async (t) => {
    const runner = await createRunner(t);
    const explorer = await startExplorerStub(t, { accounts: { [PROXY]: {} } });
    const stub = await startRpcStub(t, { chainId: 8453, ...proxyAccounts('transparent') });
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    explorer_api: ${explorer.url}\n`
    );

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '--full']);

    expect(result.stdout).toContain('none recorded');
  });

  test('a source that rejects everything leaves the explorer fields out', async (t) => {
    const runner = await createRunner(t);
    const explorer = await startExplorerStub(t, { rejects: 'Invalid API Key' });
    const stub = await startRpcStub(t, { chainId: 8453, ...proxyAccounts('transparent') });
    await runner.write(
      'config/profiles/default.yaml',
      `chains:\n  base:\n    chain_id: 8453\n    rpc_url: ${stub.url}\n    explorer_api: ${explorer.url}\n`
    );

    const result = await runner.invoke(['contract', 'proxy-info', PROXY, '--full', '--json']);

    const [row] = JSON.parse(result.stdout) as ProxyInfoResult[];
    expect(row.implementationName).toBeUndefined();
    expect(row.createdBy).toBeUndefined();
    expect(result.code).toBe(0);
  });

  test("a chain naming its own explorer_api is tried before the shared sources", async (t) => {
    const runner = await createRunner(t);
    const own = await startExplorerStub(t, { accounts: { [IMPLEMENTATION]: { name: 'FromOwn' } } });
    const stub = await startRpcStub(t, { chainId: 8453, ...proxyAccounts('transparent') });
    await runner.write(
      'config/profiles/default.yaml',
      [
        'explorers:',
        '  etherscan: ${ETHERSCAN_API_KEY}',
        'chains:',
        '  base:',
        '    chain_id: 8453',
        `    rpc_url: ${stub.url}`,
        `    explorer_api: ${own.url}`,
        '',
      ].join('\n')
    );

    const [row] = JSON.parse(
      (
        await runner.invoke(['contract', 'proxy-info', PROXY, '--full', '--json'], {
          env: { ETHERSCAN_API_KEY: 'would-be-second' },
        })
      ).stdout
    ) as ProxyInfoResult[];

    expect(row.implementationName).toBe('FromOwn');
    expect(row.explorerSource).toBe('base');
  });
});
