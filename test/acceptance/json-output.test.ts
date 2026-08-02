/**
 * Acceptance: features/json-output.feature
 *
 * A script runs the CLI and has to decide what happened without reading a
 * table. Two things are load-bearing for that, and both are asserted against
 * the built binary rather than in process: diagnostics must stay off standard
 * output, and a per-chain failure must be carried as data, because the exit
 * code will not carry it.
 */

import { describe, expect, test } from 'vitest';
import type { BalanceResult, ContractOwnerResult } from '../../src/types.js';
import { KEYS, SOME_ADDRESS, createWorkspace, parseJson, profileYaml } from '../helpers/cli.js';
import { PROXY, REFUSED_URL, proxyAccounts, startRpcStub } from '../helpers/rpc-stub.js';

describe('diagnostics stay off standard output', () => {
  test('the first-run seeding notice does not corrupt the JSON', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['chain', 'list', '--json']);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('from the bundled default profile');
    expect(() => parseJson(result.stdout)).not.toThrow();
  });

  test('the excluded-chain warning does not corrupt the JSON', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ solo: { chain_id: 31_337, rpc_url: stub.url } })
    );

    const result = await workspace.run([
      'contract', 'code', SOME_ADDRESS, '-p', 'work', '-xc', 'ghost', '--json',
    ]);

    expect(result.stderr).toContain("excluded chain 'ghost'");
    expect(() => parseJson(result.stdout)).not.toThrow();
  });

  test('the unknown price-source warning does not corrupt the JSON', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ solo: { chain_id: 31_337, rpc_url: stub.url, coingecko_id: 'ethereum' } })
    );

    const result = await workspace.run(['wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--json'], {
      env: { EVM_PRICE_SOURCE: 'off' },
    });

    expect(result.stderr).toContain("unknown price source 'off'");
    expect(() => parseJson(result.stdout)).not.toThrow();
  });

  test('the skipped-explorer note does not corrupt the JSON', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337, ...proxyAccounts('transparent') });
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ solo: { chain_id: 31_337, rpc_url: stub.url } })
    );

    const result = await workspace.run([
      'contract', 'proxy-info', PROXY, '--full', '-p', 'work', '--json',
    ]);

    expect(result.stderr).toContain('Skipped explorer lookups');
    expect(() => parseJson(result.stdout)).not.toThrow();
  });

  test('the legend is a result and the missing-default warning is a diagnostic', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/alpha.yaml', 'chains: {}\n');
    await workspace.write('config/profiles/.default', 'ghost\n');

    const result = await workspace.run(['profile', 'list']);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('ghost');
    expect(result.stdout).not.toContain('ghost');
  });

  test('with the profile in use present, the legend is on stdout and stderr is empty', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/alpha.yaml', 'chains: {}\n');
    await workspace.write('config/profiles/.default', 'alpha\n');

    const result = await workspace.run(['profile', 'list']);

    expect(result.stdout).toContain('* in use: alpha (set by evm profile set-default)');
    expect(result.stderr).toBe('');
  });
});

describe('a fan-out command returns one object per selected chain', () => {
  test('in selection order', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({
        one: { chain_id: 31_337, rpc_url: stub.url, symbol: 'ETH' },
        two: { chain_id: 31_337, rpc_url: stub.url, symbol: 'ETH' },
        three: { chain_id: 31_337, rpc_url: stub.url, symbol: 'ETH' },
      })
    );

    const result = await workspace.run([
      'wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--no-usd', '--json',
    ]);

    const rows = parseJson<BalanceResult[]>(result.stdout);
    expect(rows.map((row) => row.chain)).toEqual(['one', 'two', 'three']);
  });
});

describe('a per-chain failure is data rather than an exit code', () => {
  test('a script has to read the error key', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({
        up: { chain_id: 31_337, rpc_url: stub.url },
        down: { chain_id: 8453, rpc_url: REFUSED_URL },
      })
    );

    const result = await workspace.run([
      'wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--no-usd', '--json',
    ]);

    expect(result.code).toBe(0);
    const [up, down] = parseJson<BalanceResult[]>(result.stdout);
    expect(up.error).toBeUndefined();
    expect(down.error).toBeTruthy();
    expect(down).toMatchObject({ balance: '0', balanceEth: '0', nonce: 0 });
  });

  test('a chain the profile does not define is an object like any other', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ base: { chain_id: 8453, rpc_url: 'https://mainnet.base.org' } })
    );

    const result = await workspace.run([
      'contract', 'owner', SOME_ADDRESS, '-p', 'work', '-c', 'ghost', '--json',
    ]);

    expect(result.code).toBe(0);
    const rows = parseJson<ContractOwnerResult[]>(result.stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBe("Not in profile 'work' (evm chain set ghost <rpc-url>)");
  });
});

describe('stored values round-trip unmasked', () => {
  const withSecretHeader = [
    'chains:',
    '  base:',
    '    chain_id: 8453',
    '    rpc_url: https://mainnet.base.org',
    '    headers:',
    '      auth-key: supersecretvalue1234',
    '',
  ].join('\n');

  test('the table masks a literal header value and --json carries it whole', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', withSecretHeader);

    const table = await workspace.run(['chain', 'list', '-p', 'work']);
    expect(table.stdout).toContain('****1234');
    expect(table.stdout).not.toContain('supersecretvalue1234');

    const json = await workspace.run(['chain', 'list', '-p', 'work', '--json']);
    expect(json.stdout).toContain('supersecretvalue1234');
    expect(json.stdout).not.toContain('****');
  });

  test('an explorer key round-trips through --json unmasked', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/work.yaml',
      'explorers:\n  etherscan: supersecretvalue1234\nchains: {}\n'
    );

    const table = await workspace.run(['explorer', 'list', '-p', 'work']);
    expect(table.stdout).toContain('****1234');

    const json = await workspace.run(['explorer', 'list', '-p', 'work', '--json']);
    expect(json.stdout).toContain('supersecretvalue1234');
  });

  test('a long RPC URL is truncated in the table and whole in the JSON', async (t) => {
    const workspace = await createWorkspace(t);
    const longUrl = `https://rpc.example.invalid/${'a'.repeat(80 - 28)}`;
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ base: { chain_id: 8453, rpc_url: longUrl } })
    );

    const table = await workspace.run(['chain', 'list', '-p', 'work']);
    expect(table.stdout).toContain(`${longUrl.slice(0, 44)}…`);
    expect(table.stdout).not.toContain(longUrl);

    const json = await workspace.run(['chain', 'list', '-p', 'work', '--json']);
    expect(json.stdout).toContain(longUrl);
  });
});

describe('named commands carry named keys', () => {
  test('wallet address carries only the address', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['wallet', 'address', 'DEPLOYER_PK', '--json'], {
      env: { DEPLOYER_PK: KEYS.one.key },
    });

    expect(parseJson(result.stdout)).toEqual({ address: KEYS.one.address });
  });

  test('wallet generate carries the three fields a secret manager needs', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['wallet', 'generate', '--json']);

    expect(Object.keys(parseJson<Record<string, unknown>>(result.stdout)).sort()).toEqual([
      'address',
      'mnemonic',
      'privateKey',
    ]);
  });

  test('explorer set reports novelty and verification as booleans', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', 'chains: {}\n');

    const result = await workspace.run([
      'explorer', 'set', 'etherscan', 'somekey', '--no-verify', '-p', 'work', '--json',
    ]);

    expect(parseJson(result.stdout)).toMatchObject({ added: true, verified: false });
  });
});

describe('--json is a formatting choice, not a behavioural one', () => {
  const CASES: { command: string[]; code: number }[] = [
    { command: ['chain', 'list'], code: 0 },
    { command: ['wallet', 'balance', SOME_ADDRESS, '--no-usd'], code: 0 },
    { command: ['wallet', 'balance', 'NOPE'], code: 1 },
    { command: ['contract', 'owner', 'notanaddress'], code: 1 },
  ];

  for (const { command, code } of CASES) {
    test(`evm ${command.join(' ')} exits ${code} either way`, async (t) => {
      const workspace = await createWorkspace(t);
      const stub = await startRpcStub(t, { chainId: 31_337 });
      await workspace.write(
        'config/profiles/work.yaml',
        profileYaml({ solo: { chain_id: 31_337, rpc_url: stub.url, symbol: 'ETH' } })
      );

      const table = await workspace.run([...command, '-p', 'work']);
      const json = await workspace.run([...command, '-p', 'work', '--json']);

      expect(table.code).toBe(code);
      expect(json.code).toBe(code);
    });
  }
});
