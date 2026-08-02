/**
 * Characterization: how the environment reaches the CLI — the two `.env` files,
 * their precedence, the variables that are deliberately not read from them, and
 * `${VAR}` references inside a profile.
 *
 * Observed behaviour is what gets pinned. Tests tagged `[MISMATCH REQ-NNN]`
 * record a conflict with the approved requirements specification.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { KEYS, createWorkspace, parseJson, profileYaml, row } from '../helpers/cli.js';

const REFERENCED = profileYaml({
  ref: { chain_id: 31337, rpc_url: '${SOME_RPC_URL}' },
  plain: { chain_id: 1, rpc_url: 'http://127.0.0.1:8545' },
});

describe('.env loading', () => {
  // REQ-012, REQ-074
  test('a variable set only in ./.env reaches a command', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/.env', `DEPLOYER_PK=${KEYS.one.key}\n`);

    const result = await workspace.run(['wallet', 'address', 'DEPLOYER_PK']);

    assert.equal(result.code, 0);
    assert.equal(result.stdout, `${KEYS.one.address}\n`);
  });

  // REQ-012
  test('a variable set only in <config dir>/.env reaches a command', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/.env', `DEPLOYER_PK=${KEYS.two.key}\n`);

    const result = await workspace.run(['wallet', 'address', 'DEPLOYER_PK']);

    assert.equal(result.code, 0);
    assert.equal(result.stdout, `${KEYS.two.address}\n`);
  });

  // REQ-012: real environment > ./.env > <config dir>/.env
  test('the process environment wins, then ./.env, then the config-directory .env', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/.env', `DEPLOYER_PK=${KEYS.two.key}\n`);
    await workspace.write('config/.env', `DEPLOYER_PK=${KEYS.three.key}\n`);

    const exported = await workspace.run(['wallet', 'address', 'DEPLOYER_PK'], {
      env: { DEPLOYER_PK: KEYS.one.key },
    });
    assert.equal(exported.stdout, `${KEYS.one.address}\n`);

    const fromCwd = await workspace.run(['wallet', 'address', 'DEPLOYER_PK']);
    assert.equal(fromCwd.stdout, `${KEYS.two.address}\n`);

    const fromConfig = await workspace.run(['wallet', 'address', 'DEPLOYER_PK'], {
      cwd: workspace.home,
    });
    assert.equal(fromConfig.stdout, `${KEYS.three.address}\n`);
  });

  // REQ-011: these two decide where one of the .env files lives, so they are read
  // from the process environment only.
  test('EVM_ELF_CONFIG_DIR and XDG_CONFIG_HOME are ignored inside ./.env', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'cwd/.env',
      `EVM_ELF_CONFIG_DIR=${workspace.path('decoy')}\nXDG_CONFIG_HOME=${workspace.path('decoy')}\n`
    );

    const result = await workspace.run(['--help'], { setConfigDir: false });

    assert.ok(result.stdout.includes(`${workspace.home}/.config/evm-elf/profiles/<name>.yaml`));
    assert.ok(!result.stdout.includes(workspace.path('decoy')));
    assert.equal(await workspace.exists('decoy'), false);
  });

  // REQ-022, REQ-012, REQ-027
  test('EVM_ELF_PROFILE is honoured from ./.env, and the diagnostic agrees', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/fromfile.yaml', REFERENCED);
    await workspace.write('cwd/.env', 'EVM_ELF_PROFILE=fromfile\n');

    const list = await workspace.run(['chain', 'list', '--json']);
    assert.equal(parseJson<{ profile: string }>(list.stdout).profile, 'fromfile');

    const diagnostic = await workspace.run(['profile', 'list']);
    assert.ok(diagnostic.stdout.includes('* in use: fromfile (from $EVM_ELF_PROFILE)'));
  });

  test('a malformed .env line is skipped rather than fatal', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/.env', `!!! not a variable\nDEPLOYER_PK=${KEYS.one.key}\n`);

    const result = await workspace.run(['wallet', 'address', 'DEPLOYER_PK']);

    assert.equal(result.code, 0);
    assert.equal(result.stdout, `${KEYS.one.address}\n`);
    assert.equal(result.stderr, '');
  });

  test('a directory named .env is not fatal either', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/.env/keep', '');

    const result = await workspace.run(['--version']);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
  });
});

describe('${VAR} references in a profile', () => {
  // REQ-031
  test('an unresolved reference is an error for that chain only', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/refs.yaml', REFERENCED);

    const result = await workspace.run([
      'contract',
      'owner',
      '0x0000000000000000000000000000000000000001',
      '-p',
      'refs',
      '--json',
    ]);

    assert.equal(result.code, 0);
    const rows = parseJson<{ chain: string; error?: string }[]>(result.stdout);
    assert.equal(rows[0].error, 'Environment variable SOME_RPC_URL not set');
    assert.notEqual(rows[1].error, 'Environment variable SOME_RPC_URL not set');
  });

  // REQ-031, REQ-048
  test('chain list shows a reference as written, marking the unset ones', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/refs.yaml',
      profileYaml({
        one: {
          chain_id: 1,
          rpc_url: 'http://127.0.0.1:8545',
          headers: '{ auth-key: "${SOME_KEY}" }',
        },
      })
    );

    const unset = await workspace.run(['chain', 'list', '-p', 'refs']);
    assert.ok(row(unset.stdout, 'one')?.endsWith('auth-key: ${SOME_KEY} (unset)'), unset.stdout);

    const set = await workspace.run(['chain', 'list', '-p', 'refs'], {
      env: { SOME_KEY: 'value' },
    });
    assert.ok(row(set.stdout, 'one')?.endsWith('auth-key: ${SOME_KEY}'), set.stdout);
  });

  // REQ-048: --reveal is about literals; a reference is displayed the same either way
  test('--reveal does not change how a reference is displayed', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/refs.yaml',
      profileYaml({
        one: {
          chain_id: 1,
          rpc_url: 'http://127.0.0.1:8545',
          headers: '{ auth-key: "${SOME_KEY}", literal: supersecretvalue1234 }',
        },
      })
    );

    const masked = await workspace.run(['chain', 'list', '-p', 'refs']);
    const revealed = await workspace.run(['chain', 'list', '-p', 'refs', '--reveal']);

    assert.ok(row(masked.stdout, 'one')?.includes('literal: ****1234'));
    assert.ok(row(revealed.stdout, 'one')?.includes('literal: supersecretvalue1234'));
    for (const output of [masked.stdout, revealed.stdout]) {
      assert.ok(row(output, 'one')?.includes('auth-key: ${SOME_KEY} (unset)'));
    }
  });

  // REQ-049
  test('--json prints stored values without masking', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/refs.yaml',
      profileYaml({
        one: {
          chain_id: 1,
          rpc_url: 'http://127.0.0.1:8545',
          headers: '{ literal: supersecretvalue1234 }',
        },
      })
    );

    const result = await workspace.run(['chain', 'list', '-p', 'refs', '--json']);
    const parsed = parseJson<{ chains: { one: { headers: Record<string, string> } } }>(
      result.stdout
    );
    assert.equal(parsed.chains.one.headers.literal, 'supersecretvalue1234');
  });
});

describe('key material from the environment', () => {
  // REQ-074, REQ-075
  test('a key argument may be hex, with or without 0x, or a variable name', async (t) => {
    const workspace = await createWorkspace(t);

    for (const argument of [KEYS.one.key, KEYS.one.key.slice(2)]) {
      const result = await workspace.run(['wallet', 'address', argument]);
      assert.equal(result.stdout, `${KEYS.one.address}\n`);
    }

    const viaName = await workspace.run(['wallet', 'address', 'PK'], {
      env: { PK: KEYS.one.key },
    });
    assert.equal(viaName.stdout, `${KEYS.one.address}\n`);
  });

  // REQ-075
  test('wallet balance accepts an address, a key, or a variable holding either', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/empty.yaml', 'chains: {}\n');

    const forms: [string, Record<string, string>][] = [
      [KEYS.one.address, {}],
      [KEYS.one.key, {}],
      ['WALLET', { WALLET: KEYS.one.address }],
      ['WALLET', { WALLET: KEYS.one.key }],
    ];

    for (const [argument, env] of forms) {
      const result = await workspace.run(
        ['wallet', 'balance', argument, '-p', 'empty', '--no-usd'],
        { env }
      );
      assert.equal(result.code, 0, result.stderr);
      assert.ok(
        result.stdout.includes(`Wallet Balance: ${KEYS.one.address}`),
        `${argument} resolved to something else`
      );
    }
  });

  // REQ-076: the four key-resolution messages
  test('each way a key argument can fail has its own message', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/empty.yaml', 'chains: {}\n');

    const notAVariable = await workspace.run([
      'wallet',
      'set-nonce',
      '1',
      '--private-key',
      'NOPE',
      '-p',
      'empty',
    ]);
    assert.equal(
      notAVariable.stderr,
      '--private-key is neither a hex key nor a set environment variable: NOPE\n'
    );

    const notAKey = await workspace.run(
      ['wallet', 'set-nonce', '1', '--private-key', 'PK', '-p', 'empty'],
      { env: { PK: 'not-a-key' } }
    );
    assert.equal(notAKey.stderr, 'Private key must be a 32-byte hex string\n');

    const balanceUnknown = await workspace.run([
      'wallet',
      'balance',
      'NOPE',
      '-p',
      'empty',
    ]);
    assert.equal(
      balanceUnknown.stderr,
      'Not an address, a private key, or a set environment variable: NOPE\n'
    );

    const balanceWrongValue = await workspace.run(['wallet', 'balance', 'WALLET', '-p', 'empty'], {
      env: { WALLET: 'not-a-key' },
    });
    assert.equal(
      balanceWrongValue.stderr,
      'Env variable WALLET holds neither an address nor a 32-byte hex private key\n'
    );
  });

  // REQ-076: `wallet address` rewords the first message for its positional argument
  test('wallet address says "key argument" where the flag would say --private-key', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['wallet', 'address', 'NOPE']);

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      'key argument is neither a hex key nor a set environment variable: NOPE\n'
    );
  });

  // REQ-077, REQ-078
  test('wallet generate prints its secrets and writes nothing', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['wallet', 'generate', '--json']);
    const generated = parseJson<{ address: string; mnemonic: string; privateKey: string }>(
      result.stdout
    );

    assert.equal(result.code, 0);
    assert.match(generated.address, /^0x[0-9a-fA-F]{40}$/);
    assert.match(generated.privateKey, /^0x[0-9a-f]{64}$/);
    assert.equal(generated.mnemonic.split(' ').length, 12);
    assert.deepEqual(await workspace.tree(''), ['config', 'cwd', 'home']);

    const twentyFour = await workspace.run(['wallet', 'generate', '--words', '24', '--json']);
    assert.equal(
      parseJson<{ mnemonic: string }>(twentyFour.stdout).mnemonic.split(' ').length,
      24
    );
  });
});
