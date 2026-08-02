/**
 * Characterization: a command interrupted part-way, and one abandoned by its own
 * timeout.
 *
 * Both run against a socket that accepts the connection and answers nothing, so
 * the CLI is reliably mid-request when the signal arrives.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { createWorkspace } from '../helpers/cli.js';
import { startBlackHole } from '../helpers/rpc-stub.js';

const EMPTY_PROFILE = 'chains: {}\n';

describe('interrupted part-way through a verifying write', () => {
  // REQ-005 scopes its two exit codes to normal termination: on a signal the
  // process is terminated rather than exiting at all — waitpid reports the
  // signal, and a shell renders it as 130 for SIGINT and 143 for SIGTERM.
  // Nothing installs a handler, and REQ-005 was amended on 2026-08-01 to say so
  // rather than to require one.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    test(`${signal} terminates the process rather than setting an exit code`, async (t) => {
      const workspace = await createWorkspace(t);
      await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
      const blackHole = await startBlackHole(t);

      const running = workspace.start([
        'chain', 'set', 'hang', blackHole.url, '-p', 'work',
      ]);
      await blackHole.connected;
      running.child.kill(signal);
      const result = await running.result;

      assert.equal(result.signal, signal);
      assert.equal(result.code, null);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, '');
    });
  }

  // REQ-035: an interrupted edit cannot leave a half-written profile, because the
  // write happens after the endpoint answers and goes through a rename
  test('an interrupted write leaves the profile and the directory as they were', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    const blackHole = await startBlackHole(t);

    const running = workspace.start(['chain', 'set', 'hang', blackHole.url, '-p', 'work']);
    await blackHole.connected;
    running.child.kill('SIGINT');
    await running.result;

    assert.equal(await workspace.read('config/profiles/work.yaml'), EMPTY_PROFILE);
    assert.deepEqual(await workspace.list('config/profiles'), ['work.yaml']);
  });

  test('an interrupted read prints nothing and writes nothing', async (t) => {
    const workspace = await createWorkspace(t);
    const blackHole = await startBlackHole(t);
    await workspace.write(
      'config/profiles/work.yaml',
      `chains:\n  hang:\n    chain_id: 8453\n    rpc_url: ${blackHole.url}\n`
    );

    const running = workspace.start([
      'wallet', 'balance', '0x0000000000000000000000000000000000000001',
      '-p', 'work', '--no-usd',
    ]);
    await blackHole.connected;
    running.child.kill('SIGTERM');
    const result = await running.result;

    assert.equal(result.signal, 'SIGTERM');
    assert.equal(result.stdout, '');
    assert.deepEqual(await workspace.list('config/profiles'), ['work.yaml']);
  });
});

describe('abandoned by its own timeout', () => {
  // REQ-136: the chain-id check is bounded at 5 seconds
  test('chain set gives up on a silent endpoint after 5 seconds', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    const blackHole = await startBlackHole(t);

    const started = Date.now();
    const result = await workspace.run(['chain', 'set', 'hang', blackHole.url, '-p', 'work']);
    const elapsed = Date.now() - started;

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `Could not read the chain id from ${blackHole.url}: no response in 5000ms\n` +
        'Pass --no-verify --chain-id <id> to write the entry anyway.\n'
    );
    assert.ok(elapsed >= 5000, `gave up after ${elapsed}ms`);
    assert.ok(elapsed < 15000, `took ${elapsed}ms, which is well past the documented bound`);
    assert.equal(await workspace.read('config/profiles/work.yaml'), EMPTY_PROFILE);
  });
});
