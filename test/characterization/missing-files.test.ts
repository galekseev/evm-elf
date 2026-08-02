/**
 * Characterization: what happens when a file the command needs is not there, or
 * is there but unusable.
 *
 * REQ-057 makes this one rule for the four write commands — fail, do not create
 * the profile — and REQ-046 makes it an exit code for the profile commands.
 */

import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { describe, test } from 'vitest';
import { createWorkspace, profileYaml } from '../helpers/cli.js';

const ONE_CHAIN = profileYaml({ solo: { chain_id: 31337, rpc_url: 'http://127.0.0.1:8545' } });

describe('a profile that is not there', () => {
  // REQ-057: none of the four write commands creates the profile it was pointed at
  test('every read and write command refuses a -p that names nothing', async (t) => {
    const workspace = await createWorkspace(t);
    const missing = `${workspace.profilesDir}/ghost.yaml`;

    const commands = [
      ['chain', 'list'],
      ['chain', 'set', 'base', 'http://127.0.0.1:8545', '--chain-id', '1', '--no-verify'],
      ['chain', 'remove', 'base'],
      ['explorer', 'list'],
      ['explorer', 'set', 'etherscan', 'key', '--no-verify'],
      ['explorer', 'remove', 'etherscan'],
    ];

    for (const command of commands) {
      const result = await workspace.run([...command, '-p', 'ghost']);
      assert.equal(result.code, 1, command.join(' '));
      assert.equal(result.stderr, `Profile not found: ${missing}\n`, command.join(' '));
    }

    assert.deepEqual(await workspace.tree('config'), []);
  });

  // REQ-046
  test('the profile commands each say what is available', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/alpha.yaml', ONE_CHAIN);
    await workspace.write('config/profiles/beta.yaml', ONE_CHAIN);

    const remove = await workspace.run(['profile', 'remove', 'ghost']);
    assert.equal(remove.code, 1);
    assert.equal(
      remove.stderr,
      `Profile not found: ${workspace.profilesDir}/ghost.yaml (available: alpha, beta)\n`
    );

    const setDefault = await workspace.run(['profile', 'set-default', 'ghost']);
    assert.equal(setDefault.code, 1);
    assert.equal(
      setDefault.stderr,
      `Profile not found: ${workspace.profilesDir}/ghost.yaml ` +
        '(available: alpha, beta; create it with evm profile create ghost)\n'
    );

    const clone = await workspace.run(['profile', 'clone', 'ghost', 'copy']);
    assert.equal(clone.code, 1);
    assert.equal(clone.stderr, `Profile not found: ${workspace.profilesDir}/ghost.yaml\n`);
  });

  test('with no profiles at all the list says so', async (t) => {
    const workspace = await createWorkspace(t);

    // $EVM_ELF_PROFILE keeps the default from being seeded first
    const result = await workspace.run(['profile', 'list'], {
      env: { EVM_ELF_PROFILE: 'ghost' },
    });

    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes('No profiles yet. Create one: evm profile create myproject'));
    assert.deepEqual(await workspace.tree('config'), []);
  });

  test('an empty profile lists as empty rather than failing', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/empty.yaml', 'chains: {}\n');

    const result = await workspace.run(['chain', 'list', '-p', 'empty']);

    assert.equal(result.code, 0);
    assert.ok(
      result.stdout.includes('No chains configured. Add one: evm chain set base <rpc-url>')
    );
  });
});

describe('a chain or explorer entry that is not there', () => {
  // REQ-058
  test('removing an unconfigured chain lists what is configured', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', ONE_CHAIN);
    await workspace.write('config/profiles/empty.yaml', 'chains: {}\n');

    const withChains = await workspace.run(['chain', 'remove', 'ghost', '-p', 'work']);
    assert.equal(withChains.code, 1);
    assert.equal(
      withChains.stderr,
      `Chain 'ghost' is not in ${workspace.profilesDir}/work.yaml (configured: solo)\n`
    );

    const withNone = await workspace.run(['chain', 'remove', 'ghost', '-p', 'empty']);
    assert.equal(
      withNone.stderr,
      `Chain 'ghost' is not in ${workspace.profilesDir}/empty.yaml (configured: none)\n`
    );
  });

  // REQ-066
  test('removing an unconfigured explorer lists what is configured', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', ONE_CHAIN);

    const withNone = await workspace.run(['explorer', 'remove', 'etherscan', '-p', 'work']);
    assert.equal(withNone.code, 1);
    assert.equal(
      withNone.stderr,
      `Explorer 'etherscan' is not configured in ${workspace.profilesDir}/work.yaml ` +
        '(configured: none)\n'
    );

    await workspace.run(['explorer', 'set', 'etherscan', 'k', '--no-verify', '-p', 'work']);
    const withOne = await workspace.run(['explorer', 'remove', 'blockscout', '-p', 'work']);
    assert.equal(
      withOne.stderr,
      `Explorer 'blockscout' is not configured in ${workspace.profilesDir}/work.yaml ` +
        '(configured: etherscan)\n'
    );
  });

  // REQ-070, REQ-007: a chain the profile does not define is a row, not a failure
  test('a -c naming an unconfigured chain becomes a result row', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', ONE_CHAIN);

    const result = await workspace.run([
      'contract', 'owner', '0x0000000000000000000000000000000000000001',
      '-p', 'work', '-c', 'ghost',
    ]);

    assert.equal(result.code, 0);
    assert.ok(
      result.stdout.includes("Not in profile 'work' (evm chain set ghost <rpc-url>)"),
      result.stdout
    );
  });
});

describe('a profile that cannot be read', () => {
  // The message is whatever the filesystem said. REQ-133 asks for every message
  // that stops a command to appear in the troubleshooting reference; these do not,
  // and they do not name the profile either — see failed-operations.test.ts.
  test('a directory in place of a profile file reports EISDIR', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/isdir.yaml/keep', '');

    const read = await workspace.run(['chain', 'list', '-p', 'isdir']);
    assert.equal(read.code, 1);
    assert.equal(read.stderr, 'EISDIR: illegal operation on a directory, read\n');

    const write = await workspace.run([
      'chain', 'set', 'base', 'http://127.0.0.1:8545', '--chain-id', '1', '--no-verify',
      '-p', 'isdir',
    ]);
    assert.equal(write.code, 1);
    assert.equal(write.stderr, 'EISDIR: illegal operation on a directory, read\n');
  });

  test('an unreadable profile reports EACCES and names the path', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/locked.yaml', ONE_CHAIN);
    await chmod(workspace.path('config/profiles/locked.yaml'), 0o000);

    const result = await workspace.run(['chain', 'list', '-p', 'locked']);

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `EACCES: permission denied, open '${workspace.profilesDir}/locked.yaml'\n`
    );
  });
});
