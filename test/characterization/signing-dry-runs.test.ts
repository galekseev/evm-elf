/**
 * Characterization: what `contract transfer-ownership` and `contract
 * proxy-upgrade` do before they need a chain that can execute a transaction.
 *
 * Both commands are dry runs by default, and both do all of their checking
 * against `eth_getCode`, `eth_getStorageAt` and `eth_call` — a plan, three
 * warnings, a simulated call, and the refusals that stop `--exec` before it
 * broadcasts. None of that reaches `eth_sendRawTransaction`, so all of it is
 * reachable from a JSON-RPC stub, including the simulated call that reverts:
 * the stub answers that one with a node's own revert response rather than
 * return data.
 *
 * What this file pins is the plan and the refusals. The two paths that do
 * broadcast — a confirmed transfer and a confirmed upgrade — stay out of reach
 * and stay `@code-only` in `features/signing-operations.feature`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { id } from 'ethers';
import { EIP1967_ADMIN_SLOT } from '../../src/lib/proxy.js';
import {
  KEYS,
  SOME_ADDRESS,
  createWorkspace,
  lines,
  type RunResult,
  type TestLifecycle,
  type Workspace,
} from '../helpers/cli.js';
import {
  ADMIN,
  IMPLEMENTATION,
  IMPLEMENTATION_CODE,
  OWNER,
  PLAIN_CODE,
  PROXY,
  proxyAccounts,
  returns,
  reverts,
  startRpcStub,
  type AccountFixture,
  type RpcStub,
  type RpcStubOptions,
} from '../helpers/rpc-stub.js';

const CHAIN_ID = 31337;

/** The operator's key, held by $DEPLOYER_PK as the feature's Background has it */
const SIGNER = KEYS.one;

/** The contract under transfer-ownership, and the proxy under upgrade: 0x…01 */
const CONTRACT = SOME_ADDRESS;
const NEW_OWNER = KEYS.two.address;

/** An address the fixtures leave empty unless a test deploys code to it */
const OTHER_IMPLEMENTATION = '0x0000000000000000000000000000000000000002';

const TRANSFER_OWNERSHIP = 'transferOwnership(address)';
const UPGRADE_AND_CALL = 'upgradeAndCall(address,address,bytes)';

interface Chain {
  workspace: Workspace;
  stub: RpcStub;
  /** The CLI, with the operator's key in the environment */
  run(args: string[]): Promise<RunResult>;
}

/** A one-chain profile whose only chain is a stub in the given state */
async function oneChain(t: TestLifecycle, options: RpcStubOptions = {}): Promise<Chain> {
  const workspace = await createWorkspace(t);
  const stub = await startRpcStub(t, { chainId: CHAIN_ID, ...options });
  await workspace.write(
    'config/profiles/work.yaml',
    `chains:\n  solo:\n    chain_id: ${CHAIN_ID}\n    rpc_url: ${stub.url}\n    symbol: ETH\n`
  );
  return {
    workspace,
    stub,
    run: (args) => workspace.run(args, { env: { DEPLOYER_PK: SIGNER.key } }),
  };
}

/** A contract exposing owner(), for the transfer-ownership paths */
function ownedBy(owner: string, options: { transferReverts?: string } = {}): RpcStubOptions {
  const calls: AccountFixture['calls'] = { 'owner()': returns.address(owner) };
  if (options.transferReverts !== undefined) {
    calls[TRANSFER_OWNERSHIP] = reverts(options.transferReverts);
  }
  return { accounts: { [CONTRACT]: { code: PLAIN_CODE, calls } } };
}

interface ProxyState {
  /** Addresses given implementation bytecode, beyond IMPLEMENTATION */
  deployed?: string[];
  /** Who ProxyAdmin.owner() names; the fixture's own OWNER by default */
  adminOwner?: string;
  /** The reason ProxyAdmin.upgradeAndCall reverts with in simulation */
  upgradeReverts?: string;
  /** An admin slot pointing at an account holding no code */
  adminIsEoa?: boolean;
}

/** Chain state for a transparent proxy `proxy-upgrade` can get hold of */
function transparentProxy(state: ProxyState = {}): RpcStubOptions {
  const fixture = proxyAccounts('transparent', { adminIsEoa: state.adminIsEoa });
  const accounts = { ...fixture.accounts };
  for (const address of state.deployed ?? []) {
    accounts[address] = { code: IMPLEMENTATION_CODE };
  }
  const admin = accounts[ADMIN];
  if (admin?.calls && (state.adminOwner !== undefined || state.upgradeReverts !== undefined)) {
    accounts[ADMIN] = {
      ...admin,
      calls: {
        ...admin.calls,
        ...(state.adminOwner === undefined
          ? {}
          : { 'owner()': returns.address(state.adminOwner) }),
        ...(state.upgradeReverts === undefined
          ? {}
          : { [UPGRADE_AND_CALL]: reverts(state.upgradeReverts) }),
      },
    };
  }
  return { ...fixture, accounts };
}

/** The value of a padded `Label: value` line of a plan */
function field(output: string, label: string): string | undefined {
  const found = lines(output).find((line) => line.trim().startsWith(`${label} `));
  return found?.trim().slice(label.length).trim();
}

/** Whether the stub was asked to simulate the given function, by selector */
function simulated(stub: RpcStub, signature: string): boolean {
  const selector = id(signature).slice(0, 10);
  return stub.calls.some(
    (call) =>
      call.method === 'eth_call' &&
      String((call.params[0] as { data?: string }).data ?? '').startsWith(selector)
  );
}

/** Every attempt to put a transaction on the chain, which should be none */
function broadcasts(stub: RpcStub): string[] {
  return stub.methods().filter((method) => method.startsWith('eth_send'));
}

const transferOwnership = (...extra: string[]): string[] => [
  'contract', 'transfer-ownership', CONTRACT, NEW_OWNER,
  '--private-key', 'DEPLOYER_PK', '-c', 'solo', '-p', 'work',
  ...extra,
];

const proxyUpgrade = (implementation: string, ...extra: string[]): string[] => [
  'contract', 'proxy-upgrade', PROXY, implementation,
  '--private-key', 'DEPLOYER_PK', '-c', 'solo', '-p', 'work',
  ...extra,
];

describe('the three checks the transfer-ownership dry run performs', () => {
  // REQ-116: the plan names what it read and what it would do, and closes by
  // saying which flag would do it
  test('the plan names the contract, both owners, the signer and the simulation', async (t) => {
    const chain = await oneChain(t, ownedBy(SIGNER.address));

    const result = await chain.run(transferOwnership());

    assert.equal(result.code, 0);
    assert.equal(field(result.stdout, 'Contract:'), CONTRACT);
    assert.equal(field(result.stdout, 'Current owner:'), SIGNER.address);
    assert.equal(field(result.stdout, 'New owner:'), NEW_OWNER);
    assert.equal(field(result.stdout, 'Signer:'), SIGNER.address);
    assert.ok(result.stdout.includes('Static call succeeded'), result.stdout);
    assert.ok(
      result.stdout.includes('Re-run with --exec to send the transaction'),
      result.stdout
    );
    assert.deepEqual(broadcasts(chain.stub), []);
  });

  // REQ-116: a signer who does not own the contract is warned, and the
  // simulation is attempted anyway rather than skipped as hopeless
  test('a signer who is not the owner is warned and simulated regardless', async (t) => {
    const chain = await oneChain(t, ownedBy(OWNER));

    const result = await chain.run(transferOwnership());

    assert.equal(result.code, 0);
    assert.equal(field(result.stdout, 'Current owner:'), OWNER);
    assert.ok(
      result.stdout.includes('Warning: signer is NOT the current owner'),
      result.stdout
    );
    assert.ok(simulated(chain.stub, TRANSFER_OWNERSHIP), chain.stub.methods().join(', '));
  });

  // REQ-116: a simulation that reverts is reported with the reason the node
  // gave, and costs nothing
  test('a reverting simulation is reported with its reason and sends nothing', async (t) => {
    const chain = await oneChain(
      t,
      ownedBy(OWNER, { transferReverts: 'Ownable: caller is not the owner' })
    );

    const result = await chain.run(transferOwnership());

    assert.ok(
      result.stdout.includes('Static call reverted: Ownable: caller is not the owner'),
      result.stdout
    );
    assert.ok(!result.stdout.includes('Static call succeeded'), result.stdout);
    assert.deepEqual(broadcasts(chain.stub), []);
  });
});

describe('what a reverting dry run exits with', () => {
  // REQ-118: a plan reports what it found on standard output and exits 0 either
  // way, so a script has to read the output rather than the exit code
  const commands: [string, RpcStubOptions, string[]][] = [
    [
      'transfer-ownership',
      ownedBy(OWNER, { transferReverts: 'Ownable: caller is not the owner' }),
      transferOwnership(),
    ],
    [
      'proxy-upgrade',
      transparentProxy({ upgradeReverts: 'proxy admin unauthorized' }),
      proxyUpgrade(IMPLEMENTATION),
    ],
  ];

  for (const [name, state, args] of commands) {
    test(`a reverting ${name} plan prints the reason and still exits 0`, async (t) => {
      const chain = await oneChain(t, state);

      const result = await chain.run(args);

      assert.equal(result.code, 0);
      assert.equal(result.stderr, '');
      assert.ok(
        lines(result.stdout).some((line) => line.trim().startsWith('Static call reverted: ')),
        result.stdout
      );
    });
  }
});

describe('the admin proxy-upgrade finds for itself', () => {
  // REQ-119: the operator supplies the proxy and the new implementation, and
  // the plan reports an admin that appears in neither argument
  test('the plan reports an admin read from the EIP-1967 admin slot', async (t) => {
    const chain = await oneChain(t, transparentProxy());

    const args = proxyUpgrade(IMPLEMENTATION);
    const result = await chain.run(args);

    assert.equal(result.code, 0);
    assert.equal(field(result.stdout, 'Proxy admin:'), ADMIN);
    assert.ok(!args.includes(ADMIN), 'the admin was never typed');
    assert.ok(
      chain.stub.calls.some(
        (call) =>
          call.method === 'eth_getStorageAt' &&
          String(call.params[0]).toLowerCase() === PROXY.toLowerCase() &&
          BigInt(String(call.params[1])) === BigInt(EIP1967_ADMIN_SLOT)
      ),
      'the admin slot was read'
    );
  });
});

describe('the three conditions the proxy-upgrade dry run warns about', () => {
  const WARNINGS = {
    noCode: 'Warning: new implementation has NO code at that address',
    notAdminOwner: 'Warning: signer is NOT the ProxyAdmin owner',
    sameImplementation: 'Warning: proxy already points to this implementation',
  };

  // REQ-121: each warning has its own trigger, each leaves the plan running,
  // and the upgrade is simulated under all three
  const conditions: [string, keyof typeof WARNINGS, RpcStubOptions, string][] = [
    [
      'the new implementation holds no code',
      'noCode',
      transparentProxy({ adminOwner: SIGNER.address }),
      OTHER_IMPLEMENTATION,
    ],
    [
      'the signer does not own the ProxyAdmin',
      'notAdminOwner',
      transparentProxy({ deployed: [OTHER_IMPLEMENTATION] }),
      OTHER_IMPLEMENTATION,
    ],
    [
      'the proxy already points at the named implementation',
      'sameImplementation',
      transparentProxy({ adminOwner: SIGNER.address }),
      IMPLEMENTATION,
    ],
  ];

  for (const [name, expected, state, implementation] of conditions) {
    test(`${name} is a warning, and the plan continues`, async (t) => {
      const chain = await oneChain(t, state);

      const result = await chain.run(proxyUpgrade(implementation));

      assert.equal(result.code, 0);
      for (const [key, warning] of Object.entries(WARNINGS)) {
        assert.equal(
          result.stdout.includes(warning),
          key === expected,
          `${warning}\n${result.stdout}`
        );
      }
      assert.ok(result.stdout.includes('Static call succeeded'), result.stdout);
      assert.ok(simulated(chain.stub, UPGRADE_AND_CALL), chain.stub.methods().join(', '));
      assert.deepEqual(broadcasts(chain.stub), []);
    });
  }
});

describe('the addresses proxy-upgrade will not treat as a transparent proxy', () => {
  // REQ-123: each of the three is decided from bytecode and a storage slot, so
  // the command stops with the same message and the same exit code in either
  // mode — the dry run and --exec never get as far as differing
  const conditions: [string, RpcStubOptions, string][] = [
    ['the proxy address holds no code', {}, 'no code at proxy address'],
    [
      'the EIP-1967 admin slot is empty',
      proxyAccounts('none'),
      'EIP-1967 admin slot is empty (not a transparent proxy?)',
    ],
    [
      'the admin is an externally owned account',
      transparentProxy({ adminIsEoa: true }),
      `admin ${ADMIN} is an EOA, not a ProxyAdmin contract (upgrade it directly via the proxy)`,
    ],
  ];

  for (const [name, state, message] of conditions) {
    test(`${name} stops the command in either mode`, async (t) => {
      for (const extra of [[], ['--exec']]) {
        const chain = await oneChain(t, state);

        const result = await chain.run(proxyUpgrade(IMPLEMENTATION, ...extra));

        assert.equal(result.code, 1, `${extra.join(' ')}: ${result.stderr}`);
        assert.equal(result.stderr, `${message}\n`);
        assert.equal(result.stdout, '');
        assert.deepEqual(broadcasts(chain.stub), []);
      }
    });
  }
});

describe('what --exec refuses to broadcast', () => {
  // REQ-117: a transfer that reverts in simulation is refused, and the refusal
  // goes to standard error with exit 1 rather than being a warning
  test('a reverting transfer is refused before anything is sent', async (t) => {
    const chain = await oneChain(
      t,
      ownedBy(OWNER, { transferReverts: 'Ownable: caller is not the owner' })
    );

    const result = await chain.run(transferOwnership('--exec'));

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      'static call reverted, not sending: Ownable: caller is not the owner\n'
    );
    assert.ok(simulated(chain.stub, TRANSFER_OWNERSHIP), chain.stub.methods().join(', '));
    assert.deepEqual(broadcasts(chain.stub), []);
  });

  // REQ-122: two of the three conditions the dry run only warns about become
  // refusals under --exec, and neither reaches the chain
  const refusals: [string, RpcStubOptions, string, string][] = [
    [
      'the new implementation holds no code',
      transparentProxy({ adminOwner: SIGNER.address }),
      OTHER_IMPLEMENTATION,
      'new implementation has no code, not sending',
    ],
    [
      'the simulated upgrade reverts',
      transparentProxy({
        adminOwner: SIGNER.address,
        deployed: [OTHER_IMPLEMENTATION],
        upgradeReverts: 'proxy admin unauthorized',
      }),
      OTHER_IMPLEMENTATION,
      'static call reverted, not sending: proxy admin unauthorized',
    ],
  ];

  for (const [name, state, implementation, message] of refusals) {
    test(`${name} refuses the upgrade and broadcasts nothing`, async (t) => {
      const chain = await oneChain(t, state);

      const result = await chain.run(proxyUpgrade(implementation, '--exec'));

      assert.equal(result.code, 1);
      assert.equal(result.stderr, `${message}\n`);
      assert.equal(result.stdout, '');
      assert.deepEqual(broadcasts(chain.stub), []);
    });
  }
});
