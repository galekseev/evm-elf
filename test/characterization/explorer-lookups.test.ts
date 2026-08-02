/**
 * Characterization: the explorer-backed side of `contract proxy-info`.
 *
 * A chain entry's `explorer_api` is the first source tried for that chain, and
 * it is an Etherscan-dialect base URL like any other. Pointing it at a local
 * stub reaches the three fields `--full` reads from an explorer, the ProxyAdmin
 * trace, and the walk's behaviour when a source rejects the key — with the
 * shipped Etherscan and Blockscout URLs left exactly as they are.
 *
 * What is not reachable this way is `evm explorer set`: its probe is built
 * against the hardcoded base URL of the named source, with no per-chain
 * override, so the scenarios for a key the explorer rejects stay `@code-only`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { createWorkspace, lines, parseJson } from '../helpers/cli.js';
import {
  CREATION_TX,
  DEPLOYER,
  IMPLEMENTATION,
  OWNER,
  PROXY,
  proxyAccounts,
  startRpcStub,
} from '../helpers/rpc-stub.js';
import { addressTopic, startExplorerStub } from '../helpers/explorer-stub.js';
import { UPGRADED_TOPIC } from '../../src/lib/proxy.js';

const CHAIN_ID = 31337;
const SKIPPED_NOTE = 'Skipped explorer lookups: no API key configured.';

/** Everything the three explorer-backed fields of a UUPS proxy are read from */
const EXPLORER_FIXTURE = {
  [PROXY]: {
    creation: { txHash: CREATION_TX, creator: DEPLOYER },
    logs: {
      [UPGRADED_TOPIC]: [
        { topics: [UPGRADED_TOPIC, addressTopic(OWNER)], blockNumber: 10, timestamp: 1_600_000_000 },
        {
          topics: [UPGRADED_TOPIC, addressTopic(IMPLEMENTATION)],
          blockNumber: 20,
          timestamp: 1_700_000_000,
        },
      ],
    },
  },
  [IMPLEMENTATION]: { name: 'VaultV2' },
};

interface ProxyRow {
  chain: string;
  implementationName?: string;
  implementationVerified?: boolean;
  upgradeHistory?: { implementation: string; blockNumber: number; timestamp?: number }[];
  createdBy?: string;
  creationTxHash?: string;
  createdAt?: number;
  explorerSource?: string;
}

/** A profile of one chain in a UUPS shape, optionally naming its own explorer */
async function uupsChain(
  t: Parameters<typeof createWorkspace>[0],
  explorerApi?: string,
  extra = ''
): Promise<Awaited<ReturnType<typeof createWorkspace>>> {
  const workspace = await createWorkspace(t);
  const stub = await startRpcStub(t, { chainId: CHAIN_ID, ...proxyAccounts('uups') });
  await workspace.write(
    'config/profiles/work.yaml',
    `chains:\n  solo:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${stub.url}\n` +
      (explorerApi ? `    explorer_api: ${explorerApi}\n` : '') +
      extra
  );
  return workspace;
}

describe('the three fields --full reads from an explorer', () => {
  // REQ-111: the verified implementation name, the upgrade history from
  // Upgraded events, and the creation record
  test('all three appear when a source answers', async (t) => {
    const explorer = await startExplorerStub(t, { accounts: EXPLORER_FIXTURE });
    const workspace = await uupsChain(t, explorer.url);

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work', '--json',
    ]);

    const [inspected] = parseJson<ProxyRow[]>(result.stdout);
    assert.equal(result.code, 0);
    assert.equal(inspected.implementationName, 'VaultV2');
    assert.equal(inspected.implementationVerified, true);
    assert.deepEqual(inspected.upgradeHistory, [
      { implementation: OWNER.toLowerCase(), blockNumber: 10, timestamp: 1_600_000_000 },
      { implementation: IMPLEMENTATION.toLowerCase(), blockNumber: 20, timestamp: 1_700_000_000 },
    ]);
    assert.equal(inspected.createdBy, DEPLOYER);
    assert.equal(inspected.creationTxHash, CREATION_TX);
    assert.equal(result.stderr, '');
  });

  // REQ-111: and the table form renders each of them
  test('the table names the contract, the last upgrade and the deployer', async (t) => {
    const explorer = await startExplorerStub(t, { accounts: EXPLORER_FIXTURE });
    const workspace = await uupsChain(t, explorer.url);

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work',
    ]);

    const report = lines(result.stdout).map((line) => line.trim());
    assert.ok(report.includes('Impl contract:  VaultV2 (verified)'), result.stdout);
    assert.ok(
      report.some((line) =>
        line.startsWith(`Upgrades:       2 (last -> ${IMPLEMENTATION.toLowerCase()}`)
      ),
      result.stdout
    );
    assert.ok(report.includes(`Created by:     ${DEPLOYER}`), result.stdout);
    assert.ok(report.includes(`Creation tx:    ${CREATION_TX}`), result.stdout);
  });

  // REQ-111: a contract the source knows but has no verified source for is a
  // negative answer rather than a missing field
  test('an unverified implementation says so instead of naming a contract', async (t) => {
    const explorer = await startExplorerStub(t, { accounts: { [IMPLEMENTATION]: {} } });
    const workspace = await uupsChain(t, explorer.url);

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work',
    ]);

    assert.ok(result.stdout.includes('Impl contract:  source not verified'), result.stdout);
  });

  // REQ-111: a source that answers with no Upgraded events is a recorded
  // absence, not a lookup that failed
  test('a proxy with no Upgraded events reads "none recorded"', async (t) => {
    const explorer = await startExplorerStub(t, { accounts: { [IMPLEMENTATION]: {} } });
    const workspace = await uupsChain(t, explorer.url);

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work',
    ]);

    assert.ok(result.stdout.includes('Upgrades:       none recorded'), result.stdout);
  });

  // REQ-020: every source speaks the Etherscan dialect, which is the one API
  // shape the client builds — three actions across two modules
  test('the client asks in the Etherscan dialect', async (t) => {
    const explorer = await startExplorerStub(t, { accounts: EXPLORER_FIXTURE });
    const workspace = await uupsChain(t, explorer.url);

    await workspace.run(['contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work']);

    assert.deepEqual(explorer.actions(), ['getsourcecode', 'getLogs', 'getcontractcreation']);
    const [source, logs, creation] = explorer.requests;
    assert.deepEqual(
      { module: source.module, address: source.address },
      { module: 'contract', address: IMPLEMENTATION }
    );
    assert.deepEqual(
      { module: logs.module, address: logs.address, topic0: logs.topic0 },
      { module: 'logs', address: PROXY, topic0: UPGRADED_TOPIC }
    );
    assert.deepEqual(
      { module: creation.module, address: creation.address },
      { module: 'contract', address: PROXY }
    );
  });
});

describe('which source serves a chain', () => {
  // REQ-129: a chain's own explorer_api serves that chain alone, so it is sent
  // neither an API key nor a chain id — unlike the shared sources, which select
  // the chain with one. Which of the two is tried first is not observable from
  // a terminal, and stays @code-only.
  test('the chains own explorer_api answers as an unkeyed, single-chain source', async (t) => {
    const explorer = await startExplorerStub(t, { accounts: EXPLORER_FIXTURE });
    const workspace = await uupsChain(t, explorer.url);

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work', '--json',
    ]);

    assert.equal(parseJson<ProxyRow[]>(result.stdout)[0].explorerSource, 'solo');
    for (const request of explorer.requests) {
      assert.equal(request.apiKey, undefined, request.url);
      assert.equal(request.chainId, undefined, request.url);
    }
  });

  // REQ-130: a source whose ${VAR} does not resolve is dropped before a request
  // is issued, which leaves no source at all and so raises the note. Were it
  // kept, the run would reach the wire and the note would not appear.
  test('an unresolvable ${VAR} leaves no source, and no request is made', async (t) => {
    const workspace = await uupsChain(t, undefined, 'explorers:\n  etherscan: "${SCAN_KEY}"\n');

    const result = await workspace.run(
      ['contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work'],
      { env: { SCAN_KEY: undefined } }
    );

    assert.equal(result.code, 0);
    assert.ok(result.stderr.includes(SKIPPED_NOTE), result.stderr);
  });

  // REQ-130: and the walk carries on to the source that is usable
  test('the walk moves past the dropped source to the chains own explorer', async (t) => {
    const explorer = await startExplorerStub(t, { accounts: EXPLORER_FIXTURE });
    const workspace = await uupsChain(t, explorer.url, 'explorers:\n  etherscan: "${SCAN_KEY}"\n');

    const result = await workspace.run(
      ['contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work', '--json'],
      { env: { SCAN_KEY: undefined } }
    );

    assert.equal(parseJson<ProxyRow[]>(result.stdout)[0].explorerSource, 'solo');
    assert.equal(result.stderr, '');
  });

  // REQ-132: a source that answers with an error is skipped quietly. The fields
  // go missing and nothing explains it, which is the deviation the requirement
  // records rather than a defect.
  test('a rejected key costs the fields and produces no note', async (t) => {
    const explorer = await startExplorerStub(t, { rejects: 'Invalid API Key' });
    const workspace = await uupsChain(t, explorer.url);

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work', '--json',
    ]);

    const [inspected] = parseJson<ProxyRow[]>(result.stdout);
    assert.equal(result.code, 0);
    assert.equal(inspected.implementationName, undefined);
    assert.equal(inspected.upgradeHistory, undefined);
    assert.equal(inspected.createdBy, undefined);
    assert.equal(inspected.explorerSource, undefined);
    assert.ok(!result.stderr.includes('Skipped explorer lookups'), result.stderr);
    assert.ok(explorer.requests.length > 0, 'the source was asked, and said no');
  });
});

describe('the note raised when no source remained', () => {
  // REQ-111, REQ-131: with nothing configured the three fields are absent, and
  // one line on standard error says why
  test('no source configured means no fields and one note', async (t) => {
    const workspace = await uupsChain(t);

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work', '--json',
    ]);

    const [inspected] = parseJson<ProxyRow[]>(result.stdout);
    assert.equal(inspected.implementationName, undefined);
    assert.equal(inspected.upgradeHistory, undefined);
    assert.equal(inspected.createdBy, undefined);
    assert.equal(
      result.stderr,
      "Skipped explorer lookups: no API key configured. Add one with: evm explorer set etherscan '${ETHERSCAN_API_KEY}'\n"
    );
  });

  // REQ-131: once per run, however many chains the fan-out touched
  test('a fourteen-chain fan-out raises the note exactly once', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: CHAIN_ID, ...proxyAccounts('uups') });
    let profile = 'chains:\n';
    for (let index = 0; index < 14; index += 1) {
      profile += `  c${index}:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${stub.url}\n`;
    }
    await workspace.write('config/profiles/work.yaml', profile);

    const result = await workspace.run(['contract', 'proxy-info', PROXY, '--full', '-p', 'work']);

    assert.equal(result.code, 0);
    assert.equal(result.stderr.split(SKIPPED_NOTE).length - 1, 1, result.stderr);
  });

  // REQ-131, REQ-108: the short form wants no lookup, so it has nothing to
  // report as skipped
  test('the short form emits no note', async (t) => {
    const workspace = await uupsChain(t);

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '-s', '-c', 'solo', '-p', 'work',
    ]);

    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('Chain           Chain ID   Proxy type'), result.stdout);
  });

  // REQ-006, REQ-131: the note is a diagnostic, so it goes to standard error
  // and leaves --json parseable
  test('the note does not corrupt --json', async (t) => {
    const workspace = await uupsChain(t);

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-c', 'solo', '-p', 'work', '--json',
    ]);

    assert.ok(result.stderr.includes(SKIPPED_NOTE), result.stderr);
    assert.equal(parseJson<ProxyRow[]>(result.stdout).length, 1);
  });
});
