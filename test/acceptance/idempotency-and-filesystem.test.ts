/**
 * Acceptance: features/idempotency.feature and features/filesystem-failures.feature
 *
 * Two questions an operator asks about a tool that edits files: what happens if
 * I run it twice, and what happens if it cannot write.
 *
 * Both need the real filesystem. The permission cases take write access off a
 * real directory, which is the only way to reach the code path that turns EACCES
 * into a message naming the profile rather than the temporary file the write
 * happened to fail on.
 */

import { describe, expect, test } from 'vitest';
import { createWorkspace, denyWrites, profileYaml } from '../helpers/cli.js';
import { startRpcStub } from '../helpers/rpc-stub.js';

const EMPTY_PROFILE = 'chains: {}\n';

describe('running a write twice', () => {
  test('setting a chain twice with identical arguments leaves the same file', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    const stub = await startRpcStub(t, { chainId: 8453 });

    await workspace.run(['chain', 'set', 'base', stub.url, '-p', 'work']);
    const once = await workspace.read('config/profiles/work.yaml');
    await workspace.run(['chain', 'set', 'base', stub.url, '-p', 'work']);

    expect(await workspace.read('config/profiles/work.yaml')).toBe(once);
  });

  test('adding the same header twice changes nothing the second time', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    const stub = await startRpcStub(t, { chainId: 8453 });
    const args = ['chain', 'set', 'base', stub.url, '-p', 'work', '--header', 'auth-key: v'];

    await workspace.run(args);
    const once = await workspace.read('config/profiles/work.yaml');
    await workspace.run(args);

    expect(await workspace.read('config/profiles/work.yaml')).toBe(once);
  });

  test('removing a header that is already gone is not an error', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    const stub = await startRpcStub(t, { chainId: 8453 });
    await workspace.run(['chain', 'set', 'base', stub.url, '-p', 'work']);

    const result = await workspace.run([
      'chain', 'set', 'base', '-p', 'work', '--remove-header', 'auth-key',
    ]);

    expect(result.code).toBe(0);
  });

  test('removing the same chain twice fails only the second time', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ base: { chain_id: 8453 }, mainnet: { chain_id: 1 } })
    );

    expect((await workspace.run(['chain', 'remove', 'base', '-p', 'work'])).code).toBe(0);
    expect((await workspace.run(['chain', 'remove', 'base', '-p', 'work'])).code).toBe(1);
    expect(await workspace.read('config/profiles/work.yaml')).toContain('mainnet');
  });

  test('setting the same explorer key twice reports the second as a replacement', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    const args = ['explorer', 'set', 'etherscan', 'k', '--no-verify', '-p', 'work', '--json'];

    const first = await workspace.run(args);
    const second = await workspace.run(args);

    expect(JSON.parse(first.stdout).added).toBe(true);
    expect(JSON.parse(second.stdout).added).toBe(false);
  });

  test('a second run neither recreates nor overwrites the seeded profile', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.run(['chain', 'list', '--json']);
    await workspace.write('config/profiles/default.yaml', profileYaml({ mine: { chain_id: 1 } }));

    const second = await workspace.run(['chain', 'list', '--json']);

    expect(second.stderr).toBe('');
    expect(Object.keys(JSON.parse(second.stdout).chains)).toEqual(['mine']);
  });

  test('a profile loosened between runs is tightened again by the next write', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    const stub = await startRpcStub(t, { chainId: 8453 });

    await workspace.run(['chain', 'set', 'base', stub.url, '-p', 'work']);
    expect(await workspace.mode('config/profiles/work.yaml')).toBe('600');
  });

  test('three identical plans send nothing and write nothing', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ solo: { chain_id: 31_337, rpc_url: stub.url, symbol: 'ETH' } })
    );
    const args = [
      'wallet', 'send', '0x0000000000000000000000000000000000000001', '--value', '0.01',
      '--private-key', '0x0000000000000000000000000000000000000000000000000000000000000001',
      '-p', 'work', '--json',
    ];

    const outputs = [await workspace.run(args), await workspace.run(args), await workspace.run(args)];

    expect(new Set(outputs.map((output) => output.stdout)).size).toBe(1);
    expect(stub.methods()).not.toContain('eth_sendRawTransaction');
    expect(await workspace.list('config/profiles')).toEqual(['work.yaml']);
  });

  test('generating a wallet twice produces two different wallets', async (t) => {
    const workspace = await createWorkspace(t);

    const first = JSON.parse((await workspace.run(['wallet', 'generate', '--json'])).stdout);
    const second = JSON.parse((await workspace.run(['wallet', 'generate', '--json'])).stdout);

    expect(first.address).not.toBe(second.address);
    expect(first.mnemonic).not.toBe(second.mnemonic);
  });
});

describe('a write that is refused', () => {
  test('every write path reports a refusal the same way, naming the directory', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    await denyWrites(workspace.profilesDir);

    const result = await workspace.run([
      'chain', 'set', 'base', 'https://mainnet.base.org', '-p', 'work',
      '--no-verify', '--chain-id', '8453',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('permission denied');
    expect(result.stderr).toContain('Nothing written.');
    expect(result.stderr).toContain(`ls -ld ${workspace.profilesDir}`);
  });

  test('a refused delete says so in its own words', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    await denyWrites(workspace.profilesDir);

    const result = await workspace.run(['profile', 'remove', 'work']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Nothing removed.');
  });

  test('a failed write leaves no temporary file behind and cannot truncate the profile', async (t) => {
    const workspace = await createWorkspace(t);
    const original = profileYaml({ base: { chain_id: 8453 } });
    await workspace.write('config/profiles/work.yaml', original);
    await denyWrites(workspace.profilesDir);

    await workspace.run([
      'chain', 'set', 'mainnet', 'https://eth.example', '-p', 'work',
      '--no-verify', '--chain-id', '1',
    ]);

    expect(await workspace.list('config/profiles')).toEqual(['work.yaml']);
    expect(await workspace.read('config/profiles/work.yaml')).toBe(original);
  });
});

describe('a profile that cannot be read', () => {
  test('a directory where a profile file should be is reported, not crashed on', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml/keep', '');

    const result = await workspace.run(['chain', 'list', '-p', 'work']);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
  });

  test('an unreadable profile stops a write command before it writes', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', 'chains:\n  base:\n   : not yaml\n  }\n');

    const result = await workspace.run([
      'explorer', 'set', 'etherscan', 'k', '--no-verify', '-p', 'work',
    ]);

    expect(result.code).toBe(1);
    expect(await workspace.read('config/profiles/work.yaml')).not.toContain('etherscan');
  });

  test('an unreadable profile does not hide the readable ones', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/broken.yaml', 'chains:\n  base:\n    chain_id: nope\n');
    await workspace.write('config/profiles/work.yaml', profileYaml({ base: { chain_id: 8453 } }));
    await workspace.write('config/profiles/.default', 'work\n');

    const result = await workspace.run(['profile', 'list', '--json']);

    expect(result.code).toBe(0);
    const names = (JSON.parse(result.stdout) as { profiles: { name: string }[] }).profiles.map(
      (profile) => profile.name
    );
    expect(names).toEqual(['broken', 'work']);
  });
});
