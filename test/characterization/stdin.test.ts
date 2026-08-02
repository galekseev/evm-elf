/**
 * Characterization: standard input.
 *
 * The CLI never reads it. These tests exist so that a future change which starts
 * reading standard input — a confirmation prompt, a key read from a pipe —
 * fails here rather than in someone's script. REQ-135 makes the absence of a
 * prompt load-bearing: the dry run is the only confirmation step there is.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { KEYS, createWorkspace, profileYaml } from '../helpers/cli.js';

const ONE_CHAIN = profileYaml({ solo: { chain_id: 31337, rpc_url: 'http://127.0.0.1:8545' } });

describe('standard input is never read', () => {
  test('piped data changes nothing about a successful command', async (t) => {
    const workspace = await createWorkspace(t);

    const piped = await workspace.run(['wallet', 'address', KEYS.one.key], {
      stdin: 'hello from stdin\n',
    });
    const ignored = await workspace.run(['wallet', 'address', KEYS.one.key]);

    assert.equal(piped.code, 0);
    assert.equal(piped.stdout, `${KEYS.one.address}\n`);
    assert.equal(piped.stdout, ignored.stdout);
  });

  // The CLI exits without draining standard input, so a writer of more than a
  // pipe buffer is left with a broken pipe. That is the writer's problem, not a
  // failure of the run: the command still succeeds.
  test('a large unread input neither blocks nor breaks the run', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['--version'], { stdin: 'x'.repeat(1_000_000) });

    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, (await workspace.run(['--version'])).stdout);
    if (result.stdinError) {
      assert.equal(result.stdinError.code, 'EPIPE');
    }
  });

  test('a missing required argument is a parser error, not a prompt', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['wallet', 'address'], { stdin: `${KEYS.one.key}\n` });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, "error: missing required argument 'private-key'\n");
  });

  test('a missing required option is a parser error, not a prompt', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['wallet', 'set-nonce', '3'], { stdin: `${KEYS.one.key}\n` });

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "error: required option '--private-key <key>' not specified\n");
  });
});

describe('irreversible operations are gated by a flag, not a question', () => {
  // REQ-135
  test('removing the profile in use refuses even when stdin offers a yes', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/alpha.yaml', ONE_CHAIN);
    await workspace.run(['profile', 'set-default', 'alpha']);

    const result = await workspace.run(['profile', 'remove', 'alpha'], { stdin: 'y\ny\ny\n' });

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      "'alpha' is the profile in use; pass --force to remove it, or point elsewhere first " +
        'with evm profile set-default <name>\n'
    );
    assert.ok(await workspace.exists('config/profiles/alpha.yaml'));
  });

  // REQ-135
  test('--force removes it without asking anything', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/alpha.yaml', ONE_CHAIN);
    await workspace.run(['profile', 'set-default', 'alpha']);

    const result = await workspace.run(['profile', 'remove', 'alpha', '--force']);

    assert.equal(result.code, 0);
    assert.equal(await workspace.exists('config/profiles/alpha.yaml'), false);
    assert.equal(await workspace.exists('config/profiles/.default'), false);
  });

  // REQ-135
  test('chain remove deletes on the spot, with no confirmation step', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/alpha.yaml', ONE_CHAIN);

    const result = await workspace.run(['chain', 'remove', 'solo', '-p', 'alpha'], {
      stdin: 'n\n',
    });

    assert.equal(result.code, 0);
    assert.equal(
      result.stdout,
      `Removed solo from ${workspace.profilesDir}/alpha.yaml\n`
    );
    assert.equal(await workspace.read('config/profiles/alpha.yaml'), 'chains: {}\n');
  });
});
