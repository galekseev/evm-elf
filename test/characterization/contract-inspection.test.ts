/**
 * Characterization: `contract proxy-info` against a stubbed chain.
 *
 * Proxy detection reads storage slots and bytecode rather than an ABI, so a
 * JSON-RPC stub answering `eth_getCode`, `eth_getStorageAt` and `eth_call` from
 * a fixture is enough to drive every one of the seven branches offline. The
 * slot constants come from `src/lib/proxy.ts` by import, so a changed constant
 * fails a test instead of quietly agreeing with a stale copy.
 *
 * What this file pins is the classification and the per-type report. The
 * explorer-backed fields have their own file.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { createWorkspace, lines, parseJson, row, type Workspace } from '../helpers/cli.js';
import {
  ADMIN,
  BEACON,
  IMPLEMENTATION,
  IMPLEMENTATION_CODE,
  MANAGED_PROXY,
  OWNER,
  PROXY,
  codeHash,
  proxyAccounts,
  startRpcStub,
  type ProxyFixtureOptions,
  type ProxyKind,
} from '../helpers/rpc-stub.js';
import { startExplorerStub } from '../helpers/explorer-stub.js';

const CHAIN_ID = 31337;

/** A one-chain profile whose only chain is a stub in the given proxy shape */
async function chainInShape(
  t: Parameters<typeof createWorkspace>[0],
  kind: ProxyKind,
  options: ProxyFixtureOptions = {}
): Promise<Workspace> {
  const workspace = await createWorkspace(t);
  const stub = await startRpcStub(t, { chainId: CHAIN_ID, ...proxyAccounts(kind, options) });
  await workspace.write(
    'config/profiles/work.yaml',
    `chains:\n  solo:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${stub.url}\n    symbol: ETH\n`
  );
  return workspace;
}

/** The value of a padded `Label: value` line of the normal report */
function field(output: string, label: string): string | undefined {
  const found = lines(output).find((line) => line.trim().startsWith(`${label} `));
  return found?.trim().slice(label.length).trim();
}

interface ProxyRow {
  chain: string;
  chainId: number;
  address: string;
  proxyType?: string;
  implementation?: string;
  admin?: string;
  adminHasCode?: boolean;
  adminOwner?: string;
  beacon?: string;
  beaconOwner?: string;
  proxyOwner?: string;
  managedProxy?: string;
  managedProxyImplementation?: string;
  codeSize?: number;
  erc1822?: boolean;
  upgradeInterfaceVersion?: string;
  initializedVersion?: number;
  initializableSource?: string;
  paused?: boolean;
  pendingOwner?: string;
  balanceWei?: string;
  implementationCodeHash?: string;
  error?: string;
}

describe('the seven shapes proxy detection classifies', () => {
  // REQ-105: each detected type has a short label, read from storage slots and
  // bytecode alone. One run over seven chains, one shape each.
  test('the short form names each of the seven types', async (t) => {
    const workspace = await createWorkspace(t);
    const shapes: [string, ProxyKind, string][] = [
      ['transparent', 'transparent', 'transparent proxy'],
      ['uups', 'uups', 'UUPS proxy'],
      ['beaconproxy', 'beacon', 'beacon proxy'],
      ['clone', 'minimal', 'minimal clone'],
      ['push0clone', 'minimal-push0', 'minimal clone'],
      ['beaconcontract', 'beacon-contract', 'beacon contract'],
      ['admin', 'proxy-admin', 'ProxyAdmin'],
      ['plain', 'none', 'not a proxy'],
    ];

    let profile = 'chains:\n';
    for (const [name, kind] of shapes) {
      const stub = await startRpcStub(t, { chainId: CHAIN_ID, ...proxyAccounts(kind) });
      profile += `  ${name}:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${stub.url}\n`;
    }
    await workspace.write('config/profiles/work.yaml', profile);

    const result = await workspace.run(['contract', 'proxy-info', PROXY, '-s', '-p', 'work']);

    assert.equal(result.code, 0);
    for (const [name, , label] of shapes) {
      assert.ok(row(result.stdout, name)?.endsWith(label), `${name}: ${row(result.stdout, name)}`);
    }
  });

  // REQ-105: no ABI and no verified source take part in the detection, so no
  // explorer is consulted to reach a type
  test('detection consults no explorer', async (t) => {
    const workspace = await createWorkspace(t);
    const explorer = await startExplorerStub(t);
    const stub = await startRpcStub(t, { chainId: CHAIN_ID, ...proxyAccounts('uups') });
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${stub.url}\n` +
        `    explorer_api: ${explorer.url}\n`
    );

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work', '--json',
    ]);

    assert.equal(parseJson<ProxyRow[]>(result.stdout)[0].proxyType, 'uups');
    assert.deepEqual(explorer.requests, []);
    assert.deepEqual(new Set(stub.methods()), new Set(['eth_getCode', 'eth_getStorageAt', 'eth_call']));
  });

  // REQ-105: an address holding no code is a row that says so, not a type
  test('an address with no code is reported as such', async (t) => {
    const workspace = await createWorkspace(t);
    const bare = await startRpcStub(t, { chainId: CHAIN_ID, code: '0x' });
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  bare:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${bare.url}\n`
    );

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'bare', '-p', 'work', '--json',
    ]);

    assert.equal(result.code, 0);
    assert.equal(parseJson<ProxyRow[]>(result.stdout)[0].error, 'no code at address');
  });
});

describe('the fields each type reports', () => {
  // REQ-106: a transparent proxy reports implementation, admin, admin owner and
  // the proxy's own owner()
  test('a transparent proxy names its implementation, admin and both owners', async (t) => {
    const workspace = await chainInShape(t, 'transparent', { proxyOwner: OWNER });

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(field(result.stdout, 'Type:'), 'Transparent proxy (EIP-1967)');
    assert.equal(field(result.stdout, 'Implementation:'), `${IMPLEMENTATION} (contract)`);
    assert.equal(field(result.stdout, 'Proxy admin:'), `${ADMIN} (ProxyAdmin contract)`);
    assert.equal(field(result.stdout, 'Admin owner:'), OWNER);
    assert.equal(field(result.stdout, 'Proxy owner():'), OWNER);
  });

  // REQ-106: a UUPS proxy has no admin slot, so it reports the implementation
  // and the owner that usually authorizes an upgrade
  test('a UUPS proxy names its implementation and its owner', async (t) => {
    const workspace = await chainInShape(t, 'uups', { proxyOwner: OWNER });

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work', '--json',
    ]);

    const [inspected] = parseJson<ProxyRow[]>(result.stdout);
    assert.equal(inspected.proxyType, 'uups');
    assert.equal(inspected.implementation, IMPLEMENTATION);
    assert.equal(inspected.proxyOwner, OWNER);
    assert.equal(inspected.admin, undefined);
  });

  // REQ-106: a beacon proxy names the beacon, its owner, and the implementation
  // it reaches through beacon.implementation()
  test('a beacon proxy reaches its implementation through the beacon', async (t) => {
    const workspace = await chainInShape(t, 'beacon');

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(field(result.stdout, 'Beacon:'), `${BEACON} (contract)`);
    assert.ok(field(result.stdout, 'Beacon owner:')?.startsWith(OWNER));
    assert.ok(
      field(result.stdout, 'Implementation:')?.includes('(via beacon.implementation())'),
      field(result.stdout, 'Implementation:')
    );
  });

  // REQ-106: a clone's implementation comes out of the bytecode, and is flagged
  // as the one type that cannot be upgraded
  test('a minimal clone names the implementation embedded in its bytecode', async (t) => {
    const workspace = await chainInShape(t, 'minimal');

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(
      field(result.stdout, 'Implementation:'),
      `${IMPLEMENTATION} (contract) (embedded in bytecode, NOT upgradeable)`
    );
  });

  // REQ-106: the EIP-7511 PUSH0 variant is the same clone, read the same way
  test('the PUSH0 clone variant resolves to the same implementation', async (t) => {
    const workspace = await chainInShape(t, 'minimal-push0');

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work', '--json',
    ]);

    const [inspected] = parseJson<ProxyRow[]>(result.stdout);
    assert.equal(inspected.proxyType, 'minimal');
    assert.equal(inspected.implementation, IMPLEMENTATION);
  });

  // REQ-106: a beacon contract is not a proxy, and reports what it serves
  test('a beacon contract reports its implementation and its owner', async (t) => {
    const workspace = await chainInShape(t, 'beacon-contract', { proxyOwner: OWNER });

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(field(result.stdout, 'Type:'), 'Beacon contract (not a proxy; proxies point here)');
    assert.equal(
      field(result.stdout, 'Implementation:'),
      `${IMPLEMENTATION} (contract) (via implementation())`
    );
    assert.ok(field(result.stdout, 'Owner():')?.startsWith(OWNER));
  });

  // REQ-106: an address with none of the markers reports its owner(), when it
  // has one, and nothing else
  test('a plain contract reports only its owner()', async (t) => {
    const workspace = await chainInShape(t, 'none', { proxyOwner: OWNER });

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(field(result.stdout, 'Type:'), 'Not a proxy (no EIP-1967 slots, not a clone)');
    assert.ok(field(result.stdout, 'Owner():')?.startsWith(OWNER));
    assert.equal(field(result.stdout, 'Implementation:'), undefined);
  });

  // REQ-106: an absent field is the normal state rather than an error, so it
  // reads n/a and the command still succeeds
  test('a proxy exposing no owner() reads n/a and exits 0', async (t) => {
    const workspace = await chainInShape(t, 'transparent');

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(result.code, 0);
    assert.equal(field(result.stdout, 'Proxy owner():'), 'n/a');
  });
});

describe('what the admin line says about the admin', () => {
  // REQ-107: an admin holding code is a ProxyAdmin contract
  test('an admin with code is annotated as a ProxyAdmin contract', async (t) => {
    const workspace = await chainInShape(t, 'transparent');

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(field(result.stdout, 'Proxy admin:'), `${ADMIN} (ProxyAdmin contract)`);
  });

  // REQ-107: an admin holding no code can send upgrades itself, which is what
  // the flag is for
  test('an admin with no code is flagged as an EOA', async (t) => {
    const workspace = await chainInShape(t, 'transparent', { adminIsEoa: true });

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work', '--json',
    ]);

    const table = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(parseJson<ProxyRow[]>(result.stdout)[0].adminHasCode, false);
    assert.equal(
      field(table.stdout, 'Proxy admin:'),
      `${ADMIN} (EOA - upgrades sent directly by this account)`
    );
  });
});

describe('the diagnostics --full reads from the chain', () => {
  // REQ-109: the extra fields are there under --full and absent without it
  test('--full adds code size, the ERC-1822 check, initialization, paused and balance', async (t) => {
    const workspace = await chainInShape(t, 'uups', {
      balanceWei: 2_500_000_000_000_000_000n,
      initializedV5: 3,
      paused: true,
      pendingOwner: ADMIN,
      proxyOwner: OWNER,
    });

    const full = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work',
    ]);
    const normal = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(field(full.stdout, 'Code size:'), '17 B');
    assert.equal(
      field(full.stdout, 'ERC-1822:'),
      'confirmed (proxiableUUID matches EIP-1967 slot)'
    );
    assert.equal(field(full.stdout, 'Initialized:'), 'yes (version 3)');
    assert.equal(field(full.stdout, 'Paused:'), 'YES');
    assert.ok(field(full.stdout, 'Pending owner:')?.startsWith(ADMIN));
    assert.equal(field(full.stdout, 'Balance:'), '2.5 ETH (native funds held by this address)');
    assert.ok(field(full.stdout, 'Proxy owner():')?.includes('(EOA)'), 'owner is classified');

    for (const label of ['Code size:', 'ERC-1822:', 'Initialized:', 'Paused:', 'Balance:']) {
      assert.equal(field(normal.stdout, label), undefined, `${label} without --full`);
    }
  });

  // REQ-109: the ProxyAdmin's UPGRADE_INTERFACE_VERSION() is the --full field
  // that tells an OZ v5 admin from a v4 one
  test('--full reports the admin interface version of a transparent proxy', async (t) => {
    const workspace = await chainInShape(t, 'transparent');

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work', '--json',
    ]);

    assert.equal(parseJson<ProxyRow[]>(result.stdout)[0].upgradeInterfaceVersion, '5.0.0');
  });

  // REQ-109: an admin with no UPGRADE_INTERFACE_VERSION() is reported as v4
  // rather than as a failure
  test('an admin without the version call is described as likely OZ v4', async (t) => {
    const workspace = await createWorkspace(t);
    const fixture = proxyAccounts('transparent');
    delete fixture.accounts?.[ADMIN].calls?.['UPGRADE_INTERFACE_VERSION()'];
    const stub = await startRpcStub(t, { chainId: CHAIN_ID, ...fixture });
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${stub.url}\n`
    );

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(
      field(result.stdout, 'Admin version:'),
      'no UPGRADE_INTERFACE_VERSION() (likely OZ v4)'
    );
  });

  // REQ-109: the initialization line names the slot-0 heuristic when that is
  // where the answer came from, because slot 0 may hold something else
  test('the initialization line names the OZ v4 slot-0 heuristic', async (t) => {
    const workspace = await chainInShape(t, 'uups', { initializedV4: 1 });

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(field(result.stdout, 'Initialized:'), 'yes (version 1) (OZ v4 layout, heuristic)');
    const json = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work', '--json',
    ]);
    assert.equal(parseJson<ProxyRow[]>(json.stdout)[0].initializableSource, 'slot0-heuristic');
  });

  // REQ-109: the OZ v5 namespaced slot is read first, and named as itself
  test('the OZ v5 namespaced slot answers without the heuristic caveat', async (t) => {
    const workspace = await chainInShape(t, 'uups', { initializedV5: 2, initializedV4: 7 });

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(field(result.stdout, 'Initialized:'), 'yes (version 2)');
  });

  // REQ-109: a balance is named in the chain's own token, not in ETH
  test('the balance line uses the symbol the profile gives the chain', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, {
      chainId: CHAIN_ID,
      ...proxyAccounts('uups', { balanceWei: 3_000_000_000_000_000_000n }),
    });
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${stub.url}\n    symbol: BNB\n`
    );

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(field(result.stdout, 'Balance:'), '3.0 BNB (native funds held by this address)');
  });
});

describe('the implementation codehash and its comparison across chains', () => {
  /** A profile of `count` chains, each in the given shape with its own build */
  async function chains(
    t: Parameters<typeof createWorkspace>[0],
    codes: string[]
  ): Promise<Workspace> {
    const workspace = await createWorkspace(t);
    let profile = 'chains:\n';
    for (const [index, implementationCode] of codes.entries()) {
      const stub = await startRpcStub(t, {
        chainId: CHAIN_ID,
        ...proxyAccounts('uups', { implementationCode }),
      });
      profile += `  c${index}:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${stub.url}\n`;
    }
    await workspace.write('config/profiles/work.yaml', profile);
    return workspace;
  }

  // REQ-110: every chain reports the codehash of the implementation it found
  test('each chain carries its own Impl codehash line', async (t) => {
    const workspace = await chains(t, [IMPLEMENTATION_CODE, IMPLEMENTATION_CODE]);

    const result = await workspace.run(['contract', 'proxy-info', PROXY, '--full', '-p', 'work']);

    const hashes = lines(result.stdout).filter((line) => line.includes('Impl codehash:'));
    assert.equal(hashes.length, 2);
    for (const line of hashes) {
      assert.ok(line.includes(codeHash(IMPLEMENTATION_CODE)), line);
    }
  });

  // REQ-110: three chains on the same build get the one-line all-clear
  test('identical bytecode across three chains is reported as identical', async (t) => {
    const workspace = await chains(t, Array(3).fill(IMPLEMENTATION_CODE));

    const result = await workspace.run(['contract', 'proxy-info', PROXY, '--full', '-p', 'work']);

    assert.ok(
      result.stdout.includes('Implementation bytecode is identical on all 3 chains'),
      result.stdout
    );
  });

  // REQ-110: a chain on a different build is named under a variant count
  test('a differing chain is reported as a second variant', async (t) => {
    const workspace = await chains(t, [IMPLEMENTATION_CODE, IMPLEMENTATION_CODE, '0xfe00']);

    const result = await workspace.run(['contract', 'proxy-info', PROXY, '--full', '-p', 'work']);

    assert.ok(
      result.stdout.includes('Implementation bytecode DIFFERS across chains (2 variants):'),
      result.stdout
    );
  });

  // REQ-110: OQ-3 in the example map — the documentation states the comparison
  // unconditionally, the build skips it below two codehashes. This is the build.
  test('a single-chain run reports the codehash and no comparison', async (t) => {
    const workspace = await chains(t, [IMPLEMENTATION_CODE]);

    const result = await workspace.run(['contract', 'proxy-info', PROXY, '--full', '-p', 'work']);

    assert.ok(result.stdout.includes('Impl codehash:'), result.stdout);
    assert.ok(!result.stdout.includes('Implementation bytecode'), result.stdout);
  });
});

describe('the short form and what it leaves out', () => {
  // REQ-108, REQ-112: -s skips the owner lookups and the ProxyAdmin trace, so
  // its columns are the only thing it reports
  test('-s issues no owner() call and traces no managed proxy', async (t) => {
    const workspace = await createWorkspace(t);
    const explorer = await startExplorerStub(t);
    const stub = await startRpcStub(t, { chainId: CHAIN_ID, ...proxyAccounts('proxy-admin') });
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${stub.url}\n` +
        `    explorer_api: ${explorer.url}\n`
    );

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-s', '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes('Chain           Chain ID   Proxy type'), result.stdout);
    assert.ok(!stub.methods().includes('eth_call'), stub.methods().join(', '));
    assert.deepEqual(explorer.requests, []);
  });

  // REQ-112: the trace runs in the default mode, without --full
  test('the ProxyAdmin trace runs without --full and finds the managed proxy', async (t) => {
    const workspace = await createWorkspace(t);
    const explorer = await startExplorerStub(t, {
      accounts: {
        [PROXY]: { creation: { txHash: `0x${'cc'.repeat(32)}`, creator: OWNER } },
      },
    });
    const stub = await startRpcStub(t, { chainId: CHAIN_ID, ...proxyAccounts('proxy-admin') });
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  solo:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${stub.url}\n` +
        `    explorer_api: ${explorer.url}\n`
    );

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work', '--json',
    ]);

    const [inspected] = parseJson<ProxyRow[]>(result.stdout);
    assert.equal(inspected.proxyType, 'proxy-admin');
    assert.equal(inspected.managedProxy, MANAGED_PROXY);
    assert.equal(inspected.managedProxyImplementation, IMPLEMENTATION);
    assert.ok(explorer.actions().includes('getcontractcreation'), 'the trace needs the explorer');
  });

  // REQ-112: without a source the trace cannot start, and the line says why
  test('with no explorer the managed proxy line explains what is missing', async (t) => {
    const workspace = await chainInShape(t, 'proxy-admin');

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(
      field(result.stdout, 'Managed proxy:'),
      'not found (works for OZ v5 admins created by their proxy; needs an explorer API)'
    );
  });
});
