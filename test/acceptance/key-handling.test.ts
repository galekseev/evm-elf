/**
 * Acceptance: features/key-handling.feature
 *
 * The guarantees here are stated as prohibitions — a key must not reach a file,
 * a table cell, a JSON field, or an outbound request — which is exactly why
 * they belong at this layer. A prohibition is only worth asserting against the
 * whole process: everything it writes, and everything the endpoint received.
 */

import { describe, expect, test } from 'vitest';
import { KEYS, SOME_ADDRESS, createWorkspace, parseJson, profileYaml } from '../helpers/cli.js';
import { startRpcStub, type RpcStub } from '../helpers/rpc-stub.js';

const SIGNER = KEYS.one;

/** Everything written anywhere under the workspace, as one string to search */
async function everythingWritten(workspace: Awaited<ReturnType<typeof createWorkspace>>): Promise<string> {
  const paths = await workspace.tree();
  const contents = await Promise.all(
    paths.map(async (path) => {
      try {
        return await workspace.read(path);
      } catch {
        return '';
      }
    })
  );
  return [...paths, ...contents].join('\n');
}

async function oneChain(
  workspace: Awaited<ReturnType<typeof createWorkspace>>,
  stub: RpcStub
): Promise<void> {
  await workspace.write(
    'config/profiles/work.yaml',
    profileYaml({ solo: { chain_id: 31_337, rpc_url: stub.url, symbol: 'ETH' } })
  );
}

describe('no profile field holds a private key', () => {
  test('a hand-added key field rejects the profile rather than being used', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/work.yaml',
      [
        'chains:',
        '  base:',
        '    chain_id: 8453',
        '    rpc_url: https://mainnet.base.org',
        `    private_key: ${SIGNER.key}`,
        '',
      ].join('\n')
    );

    const result = await workspace.run(['chain', 'list', '-p', 'work']);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `Invalid profile: chain 'base' in ${workspace.profilesDir}/work.yaml has unknown field 'private_key'\n`
    );
  });
});

describe('keys are never written to a file', () => {
  test('generating a wallet stores nothing', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['wallet', 'generate']);

    expect(result.code).toBe(0);
    expect(await workspace.tree('config')).toEqual([]);
    expect(await workspace.tree('cwd')).toEqual([]);
  });

  test('a signing command writes no key anywhere on disk', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await oneChain(workspace, stub);

    await workspace.run(
      [
        'wallet', 'send', SOME_ADDRESS, '--value', '0.01',
        '--private-key', 'DEPLOYER_PK', '-c', 'solo', '-p', 'work',
      ],
      { env: { DEPLOYER_PK: SIGNER.key } }
    );

    expect(await everythingWritten(workspace)).not.toContain(SIGNER.key);
  });
});

describe('keys are never printed, except by the command whose purpose is to print one', () => {
  const COMMANDS = [
    ['wallet', 'send', SOME_ADDRESS, '--value', '0.01', '--private-key', 'DEPLOYER_PK', '-c', 'solo'],
    ['wallet', 'set-nonce', '40', '--private-key', 'DEPLOYER_PK', '-c', 'solo'],
    ['wallet', 'balance', 'DEPLOYER_PK', '--no-usd'],
  ];

  for (const command of COMMANDS) {
    test(`evm ${command.slice(0, 2).join(' ')} identifies the signer by its address`, async (t) => {
      const workspace = await createWorkspace(t);
      const stub = await startRpcStub(t, { chainId: 31_337 });
      await oneChain(workspace, stub);

      const result = await workspace.run([...command, '-p', 'work', '--json'], {
        env: { DEPLOYER_PK: SIGNER.key },
      });

      expect(result.stdout).not.toContain(SIGNER.key);
      expect(result.stderr).not.toContain(SIGNER.key);
      expect(result.stdout).toContain(SIGNER.address);
    });
  }

  test('the same holds under --json', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['wallet', 'address', 'DEPLOYER_PK', '--json'], {
      env: { DEPLOYER_PK: SIGNER.key },
    });

    expect(parseJson(result.stdout)).toEqual({ address: SIGNER.address });
    expect(result.stdout).not.toContain(SIGNER.key);
  });

  test('wallet generate prints both by design, and says they are shown once', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['wallet', 'generate']);

    expect(result.stdout).toContain('Mnemonic:');
    expect(result.stdout).toContain('Private key:');
    expect(result.stdout.toLowerCase()).toContain('once');
  });
});

describe('the key never leaves the process except as a signature', () => {
  test('no request to the endpoint carries the key', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await oneChain(workspace, stub);

    await workspace.run(
      ['wallet', 'set-nonce', '40', '--private-key', 'DEPLOYER_PK', '-c', 'solo', '-p', 'work'],
      { env: { DEPLOYER_PK: SIGNER.key } }
    );

    const traffic = JSON.stringify(stub.calls);
    expect(traffic).not.toContain(SIGNER.key);
    expect(traffic).not.toContain(SIGNER.key.slice(2));
  });

  test('no eth_sendTransaction or personal_* method is used', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await oneChain(workspace, stub);

    await workspace.run(
      [
        'wallet', 'send', SOME_ADDRESS, '--value', '0.01',
        '--private-key', 'DEPLOYER_PK', '-c', 'solo', '-p', 'work',
      ],
      { env: { DEPLOYER_PK: SIGNER.key } }
    );

    for (const method of stub.methods()) {
      expect(method).not.toBe('eth_sendTransaction');
      expect(method.startsWith('personal_')).toBe(false);
    }
  });
});

describe('a key argument is resolved by shape, then by lookup', () => {
  test('a value shaped like a key is used as one, without consulting the environment', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['wallet', 'address', SIGNER.key]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toContain(SIGNER.address);
  });

  const ARGUMENTS: { argument: string; holds?: string }[] = [
    { argument: SIGNER.address },
    { argument: SIGNER.key },
    { argument: 'WALLET', holds: SIGNER.address },
    { argument: 'WALLET', holds: SIGNER.key },
  ];

  for (const { argument, holds } of ARGUMENTS) {
    const description = holds
      ? `a variable holding ${holds === SIGNER.key ? 'a key' : 'an address'}`
      : `${argument === SIGNER.key ? 'a key' : 'an address'} given directly`;

    test(`wallet balance accepts ${description}`, async (t) => {
      const workspace = await createWorkspace(t);
      const stub = await startRpcStub(t, { chainId: 31_337 });
      await oneChain(workspace, stub);

      const result = await workspace.run(
        ['wallet', 'balance', argument, '-p', 'work', '--no-usd'],
        holds ? { env: { WALLET: holds } } : {}
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`Wallet Balance: ${SIGNER.address}`);
      expect(stub.methods()).not.toContain('eth_sendRawTransaction');
    });
  }
});

describe('a profile may hold a secret that is not a key', () => {
  test('a literal header value is protected on screen', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/work.yaml',
      [
        'chains:',
        '  base:',
        '    chain_id: 8453',
        '    rpc_url: https://mainnet.base.org',
        '    headers:',
        '      auth-key: supersecretvalue1234',
        '',
      ].join('\n')
    );

    const result = await workspace.run(['chain', 'list', '-p', 'work']);

    expect(result.stdout).toContain('****1234');
    expect(result.stdout).not.toContain('supersecretvalue1234');
  });

  test('a reference is not a secret, so revealing it reveals nothing', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/work.yaml',
      [
        'chains:',
        '  base:',
        '    chain_id: 8453',
        '    rpc_url: https://mainnet.base.org',
        '    headers:',
        '      auth-key: ${BASE_KEY}',
        '',
      ].join('\n')
    );

    const result = await workspace.run(['chain', 'list', '-p', 'work', '--reveal'], {
      env: { BASE_KEY: 'supersecretvalue1234' },
    });

    expect(result.stdout).toContain('${BASE_KEY}');
    expect(result.stdout).not.toContain('supersecretvalue1234');
  });
});

describe('there is no prompt, so the plan is the only confirmation step', () => {
  test('an irreversible operation needs a flag, and answering yes does nothing', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await oneChain(workspace, stub);

    const result = await workspace.run(
      [
        'wallet', 'send', SOME_ADDRESS, '--all',
        '--private-key', 'DEPLOYER_PK', '-c', 'solo', '-p', 'work',
      ],
      { env: { DEPLOYER_PK: SIGNER.key }, stdin: 'yes\n' }
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('--exec');
    expect(stub.methods()).not.toContain('eth_sendRawTransaction');
  });

  test('data on standard input changes nothing about a successful command', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', 'chains: {}\n');

    const quiet = await workspace.run(['chain', 'list', '-p', 'work', '--json']);
    const noisy = await workspace.run(['chain', 'list', '-p', 'work', '--json'], {
      stdin: 'yes\nyes\nyes\n',
    });

    expect(noisy.code).toBe(quiet.code);
    expect(noisy.stdout).toBe(quiet.stdout);
  });
});
