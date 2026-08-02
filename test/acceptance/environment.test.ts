/**
 * Acceptance: features/environment.feature and features/working-directory.feature
 *
 * Where the CLI reads its configuration from, and what the directory it was
 * launched in changes about that. Both are properties of a process — an
 * exported variable, a `.env` beside the caller, a relative path resolved
 * against the caller's cwd — so both are asserted by launching one.
 */

import { describe, expect, test } from 'vitest';
import { KEYS, SOME_ADDRESS, createWorkspace, parseJson, profileYaml } from '../helpers/cli.js';
import { startRpcStub } from '../helpers/rpc-stub.js';

interface ProfileList {
  default: string;
  source: 'env' | 'pointer' | 'builtin';
}

describe('the first source that names a profile wins', () => {
  test('$EVM_ELF_PROFILE outranks the pointer file', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/from-env.yaml', 'chains: {}\n');
    await workspace.write('config/profiles/from-pointer.yaml', 'chains: {}\n');
    await workspace.write('config/profiles/.default', 'from-pointer\n');

    const result = await workspace.run(['profile', 'list', '--json'], {
      env: { EVM_ELF_PROFILE: 'from-env' },
    });

    expect(parseJson<ProfileList>(result.stdout)).toMatchObject({
      default: 'from-env',
      source: 'env',
    });
  });

  test('an explicit -p outranks all three', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/.default', 'from-pointer\n');
    await workspace.write(
      'config/profiles/explicit.yaml',
      profileYaml({ 'only-here': { chain_id: 7 } })
    );

    const result = await workspace.run(['chain', 'list', '--json', '-p', 'explicit'], {
      env: { EVM_ELF_PROFILE: 'from-env' },
    });

    expect(parseJson<{ profile: string }>(result.stdout).profile).toBe('explicit');
  });

  test('with no source at all, the built-in name is used and reported as built-in', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['profile', 'list', '--json']);

    expect(parseJson<ProfileList>(result.stdout)).toMatchObject({
      default: 'default',
      source: 'builtin',
    });
  });
});

describe('a .env file behaves exactly as an exported variable', () => {
  test('a variable in ./.env is found', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/.env', `DEPLOYER_PK=${KEYS.one.key}\n`);

    const result = await workspace.run(['wallet', 'address', 'DEPLOYER_PK', '--json']);

    expect(result.code).toBe(0);
    expect(parseJson(result.stdout)).toEqual({ address: KEYS.one.address });
  });

  test("a variable in the configuration directory's .env is found too", async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/.env', `DEPLOYER_PK=${KEYS.two.key}\n`);

    const result = await workspace.run(['wallet', 'address', 'DEPLOYER_PK', '--json']);

    expect(parseJson(result.stdout)).toEqual({ address: KEYS.two.address });
  });

  test("between the two files, the working directory's wins", async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/.env', `DEPLOYER_PK=${KEYS.one.key}\n`);
    await workspace.write('config/.env', `DEPLOYER_PK=${KEYS.two.key}\n`);

    const result = await workspace.run(['wallet', 'address', 'DEPLOYER_PK', '--json']);

    expect(parseJson(result.stdout)).toEqual({ address: KEYS.one.address });
  });

  test('an exported variable outranks both files', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/.env', `DEPLOYER_PK=${KEYS.one.key}\n`);

    const result = await workspace.run(['wallet', 'address', 'DEPLOYER_PK', '--json'], {
      env: { DEPLOYER_PK: KEYS.three.key },
    });

    expect(parseJson(result.stdout)).toEqual({ address: KEYS.three.address });
  });

  test('a configuration directory named in ./.env is ignored, because it is read too late', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/.env', `EVM_ELF_CONFIG_DIR=${workspace.path('elsewhere')}\n`);

    const result = await workspace.run(['profile', 'list', '--json']);

    expect(result.stdout).toContain(workspace.profilesDir);
    expect(result.stdout).not.toContain(workspace.path('elsewhere'));
  });
});

describe('a ${VAR} in a profile', () => {
  test('is resolved and used, and the run succeeds', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ solo: { chain_id: 31_337, rpc_url: '${SOLO_RPC}' } })
    );

    const result = await workspace.run(
      ['wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--no-usd', '--json'],
      { env: { SOLO_RPC: stub.url } }
    );

    expect(result.code).toBe(0);
    expect(parseJson<{ error?: string }[]>(result.stdout)[0].error).toBeUndefined();
  });

  test('is reported as written by chain list, never expanded', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ solo: { chain_id: 31_337, rpc_url: '${SOLO_RPC}' } })
    );

    const result = await workspace.run(['chain', 'list', '-p', 'work'], {
      env: { SOLO_RPC: 'https://secret.example/rpc' },
    });

    expect(result.stdout).toContain('${SOLO_RPC}');
    expect(result.stdout).not.toContain('https://secret.example/rpc');
  });
});

describe('the price source variable', () => {
  test('a recognised value is honoured silently', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ solo: { chain_id: 31_337, rpc_url: stub.url, coingecko_id: 'ethereum' } })
    );

    const result = await workspace.run(['wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--json'], {
      env: { EVM_PRICE_SOURCE: 'none' },
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('an unrecognised value stops the lookup and says so on standard error', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ solo: { chain_id: 31_337, rpc_url: stub.url, coingecko_id: 'ethereum' } })
    );

    const result = await workspace.run(['wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--json'], {
      env: { EVM_PRICE_SOURCE: 'off' },
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("using 'none'");
  });

  test('a run that wanted no prices anyway stays quiet', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ solo: { chain_id: 31_337, rpc_url: stub.url } })
    );

    const result = await workspace.run([
      'wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--no-usd', '--json',
    ]);

    expect(result.stderr).toBe('');
  });
});

describe('the working directory decides', () => {
  test('a key in the local .env is found beside the caller and not one directory away', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/project/.env', `DEPLOYER_PK=${KEYS.one.key}\n`);

    const beside = await workspace.run(['wallet', 'address', 'DEPLOYER_PK'], {
      cwd: workspace.path('cwd', 'project'),
    });
    expect(beside.code).toBe(0);

    const away = await workspace.run(['wallet', 'address', 'DEPLOYER_PK'], {
      cwd: workspace.cwd,
    });
    expect(away.code).toBe(1);
  });

  test('a profile committed to a repository is usable through a relative -p', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'cwd/project/team-chains.yaml',
      profileYaml({ base: { chain_id: 8453, rpc_url: 'https://mainnet.base.org' } })
    );

    const result = await workspace.run(['chain', 'list', '-p', './team-chains.yaml', '--json'], {
      cwd: workspace.path('cwd', 'project'),
    });

    expect(result.code).toBe(0);
    expect(parseJson<{ path: string }>(result.stdout).path).toBe(
      workspace.path('cwd', 'project', 'team-chains.yaml')
    );
  });

  test('a path is not held to the profile-name pattern', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/not a valid name.yaml', 'chains: {}\n');

    const result = await workspace.run(['chain', 'list', '-p', './not a valid name.yaml', '--json']);

    expect(result.code).toBe(0);
  });

  test('a write through a relative -p lands beside the caller, owner-only', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/local.yaml', 'chains: {}\n');
    const stub = await startRpcStub(t, { chainId: 8453 });

    const result = await workspace.run(['chain', 'set', 'base', stub.url, '-p', './local.yaml']);

    expect(result.code).toBe(0);
    expect(await workspace.read('cwd/local.yaml')).toContain('chain_id: 8453');
    expect(await workspace.mode('cwd/local.yaml')).toBe('600');
  });
});

describe('the working directory does not decide', () => {
  test('an ordinary command creates nothing in it and leaves it as it was', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['wallet', 'generate', '--json']);

    expect(result.code).toBe(0);
    expect(await workspace.tree('cwd')).toEqual([]);
  });

  test('the same profile resolves the same from three different places', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', profileYaml({ base: { chain_id: 8453 } }));
    await workspace.write('cwd/nested/deeper/.keep', '');

    const paths = [workspace.cwd, workspace.path('cwd', 'nested'), workspace.path('cwd', 'nested', 'deeper')];
    const outputs = await Promise.all(
      paths.map((cwd) => workspace.run(['chain', 'list', '-p', 'work', '--json'], { cwd }))
    );

    expect(new Set(outputs.map((output) => output.stdout)).size).toBe(1);
  });

  test('after any sequence of commands the configuration directory holds only its own artefacts', async (t) => {
    const workspace = await createWorkspace(t);

    await workspace.run(['profile', 'create', 'work']);
    await workspace.run(['profile', 'set-default', 'work']);
    await workspace.run(['chain', 'list']);
    await workspace.run(['wallet', 'generate']);

    // Nothing beyond the profiles directory, the profile files in it, and the
    // pointer. `default.yaml` is absent because set-default pointed the later
    // commands at `work`, and only the profile in use is ever seeded.
    expect(await workspace.tree('config')).toEqual([
      'profiles',
      'profiles/.default',
      'profiles/work.yaml',
    ]);
  });
});
