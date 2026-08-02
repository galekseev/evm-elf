/**
 * Characterization: what the working directory decides.
 *
 * Three things depend on it — the `./.env` file, a relative `-p` path, and a
 * relative `$EVM_ELF_CONFIG_DIR` — and the configuration directory itself does
 * not, once it resolves to an absolute path.
 */

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { describe, test } from 'vitest';
import { KEYS, createWorkspace, parseJson, profileYaml } from '../helpers/cli.js';

const ONE_CHAIN = profileYaml({ solo: { chain_id: 31337, rpc_url: 'http://127.0.0.1:8545' } });

describe('the working directory decides', () => {
  // REQ-012
  test('./.env is read from the directory the command runs in', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/.env', `PK=${KEYS.one.key}\n`);
    await mkdir(workspace.path('elsewhere'));

    const here = await workspace.run(['wallet', 'address', 'PK']);
    assert.equal(here.stdout, `${KEYS.one.address}\n`);

    const there = await workspace.run(['wallet', 'address', 'PK'], {
      cwd: workspace.path('elsewhere'),
    });
    assert.equal(there.code, 1);
    assert.equal(
      there.stderr,
      'key argument is neither a hex key nor a set environment variable: PK\n'
    );
  });

  // REQ-023
  test('a relative -p is resolved against the working directory', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/nested/local.yaml', ONE_CHAIN);

    const fromCwd = await workspace.run(['chain', 'list', '--json', '-p', 'nested/local.yaml']);
    assert.equal(
      parseJson<{ path: string }>(fromCwd.stdout).path,
      workspace.path('cwd/nested/local.yaml')
    );

    const fromNested = await workspace.run(['chain', 'list', '--json', '-p', './local.yaml'], {
      cwd: workspace.path('cwd/nested'),
    });
    assert.equal(
      parseJson<{ path: string }>(fromNested.stdout).path,
      workspace.path('cwd/nested/local.yaml')
    );
  });

  // REQ-016 bounds writes to the configuration directory or an explicit -p path.
  // A relative -p is such a path, so a write lands beside the caller.
  test('a write through a relative -p lands relative to the working directory', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/out.yaml', 'chains: {}\n');

    const result = await workspace.run([
      'chain',
      'set',
      'base',
      'http://127.0.0.1:8545',
      '--chain-id',
      '8453',
      '--no-verify',
      '-p',
      './out.yaml',
    ]);

    assert.equal(result.code, 0);
    assert.ok(result.stdout.startsWith(`Added base to ${workspace.path('cwd/out.yaml')}`));
    assert.match(await workspace.read('cwd/out.yaml'), /chain_id: 8453/);
    assert.deepEqual(await workspace.tree('config'), []);
  });

  // REQ-036: the target is tightened even when the operator's own file was laxer
  test('a write through -p leaves the file owner-only', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/out.yaml', 'chains: {}\n');
    const { chmod } = await import('node:fs/promises');
    await chmod(workspace.path('cwd/out.yaml'), 0o644);

    await workspace.run([
      'chain',
      'set',
      'base',
      'http://127.0.0.1:8545',
      '--chain-id',
      '8453',
      '--no-verify',
      '-p',
      './out.yaml',
    ]);

    assert.equal(await workspace.mode('cwd/out.yaml'), '600');
  });
});

describe('the working directory does not decide', () => {
  // REQ-010: an absolute configuration directory is the same from anywhere
  test('an absolute $EVM_ELF_CONFIG_DIR is independent of the working directory', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/alpha.yaml', ONE_CHAIN);
    await mkdir(workspace.path('elsewhere'));

    for (const cwd of [workspace.cwd, workspace.path('elsewhere'), workspace.home]) {
      const result = await workspace.run(['chain', 'list', '--json', '-p', 'alpha'], { cwd });
      assert.equal(
        parseJson<{ path: string }>(result.stdout).path,
        `${workspace.profilesDir}/alpha.yaml`
      );
    }
  });

  test('an ordinary command creates nothing in the working directory', async (t) => {
    const workspace = await createWorkspace(t);

    for (const args of [
      ['--version'],
      ['chain', 'list'],
      ['profile', 'list'],
      ['profile', 'create', 'alpha'],
      ['chain', 'set', 'zz', 'http://127.0.0.1:8545', '--chain-id', '1', '--no-verify'],
      ['wallet', 'generate'],
    ]) {
      await workspace.run(args);
    }

    assert.deepEqual(await workspace.tree('cwd'), []);
  });
});
