/**
 * Acceptance: features/interruption.feature
 *
 * A signal mid-run, and an endpoint that never answers. Both need a real
 * process — there is nothing to send a signal to otherwise — and both are about
 * what is *not* left behind: no partial profile, no half-printed table, no
 * broadcast.
 *
 * Nothing installs a signal handler, so an interrupted run is terminated by its
 * signal rather than exiting with a code. That distinction is the assertion.
 */

import { describe, expect, test } from 'vitest';
import { SOME_ADDRESS, createWorkspace, profileYaml } from '../helpers/cli.js';
import { REFUSED_URL, startBlackHole, startRpcStub } from '../helpers/rpc-stub.js';

const EMPTY_PROFILE = 'chains: {}\n';

describe('a signal during a verifying write', () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    test(`${signal} terminates the run and leaves the profile as it was`, async (t) => {
      const workspace = await createWorkspace(t);
      await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
      const blackHole = await startBlackHole(t);

      const running = workspace.start(['chain', 'set', 'hang', blackHole.url, '-p', 'work']);
      await blackHole.connected;
      running.child.kill(signal);
      const result = await running.result;

      expect(result.signal).toBe(signal);
      expect(result.code).toBeNull();
      expect(await workspace.read('config/profiles/work.yaml')).toBe(EMPTY_PROFILE);
    });
  }

  test('the profiles directory holds nothing the interrupted run created', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    const blackHole = await startBlackHole(t);

    const running = workspace.start(['chain', 'set', 'hang', blackHole.url, '-p', 'work']);
    await blackHole.connected;
    running.child.kill('SIGINT');
    await running.result;

    expect(await workspace.list('config/profiles')).toEqual(['work.yaml']);
  });

  test('an interrupted read writes nothing and prints no partial table', async (t) => {
    const workspace = await createWorkspace(t);
    const blackHole = await startBlackHole(t);
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({ hang: { chain_id: 8453, rpc_url: blackHole.url } })
    );

    const running = workspace.start([
      'wallet', 'balance', SOME_ADDRESS, '-p', 'work', '--no-usd',
    ]);
    await blackHole.connected;
    running.child.kill('SIGTERM');
    const result = await running.result;

    expect(result.signal).toBe('SIGTERM');
    expect(result.stdout).toBe('');
    expect(await workspace.list('config/profiles')).toEqual(['work.yaml']);
  });
});

describe('interrupting a fan-out', () => {
  test('stops it where it stood, having broadcast nothing', async (t) => {
    const workspace = await createWorkspace(t);
    const stub = await startRpcStub(t, { chainId: 31_337 });
    const blackHole = await startBlackHole(t);
    await workspace.write(
      'config/profiles/work.yaml',
      profileYaml({
        first: { chain_id: 31_337, rpc_url: stub.url, symbol: 'ETH' },
        second: { chain_id: 31_337, rpc_url: blackHole.url, symbol: 'ETH' },
        third: { chain_id: 31_337, rpc_url: stub.url, symbol: 'ETH' },
      })
    );

    const running = workspace.start(
      [
        'wallet', 'send', SOME_ADDRESS, '--all',
        '--private-key', '0x0000000000000000000000000000000000000000000000000000000000000001',
        '-p', 'work',
      ],
      { timeoutMs: 15_000 }
    );
    // The progress line for a chain is printed once that chain has answered, so
    // seeing the first one means the run is now stuck on the silent second.
    await running.waitForOutput(/\[1\/3\] first:/);
    running.child.kill('SIGINT');
    const result = await running.result;

    expect(result.signal).toBe('SIGINT');
    expect(result.stdout).toContain('[1/3] first:');
    expect(result.stdout).not.toContain('[2/3] second: would send');
    expect(result.stdout).not.toContain('[3/3]');
    expect(stub.methods()).not.toContain('eth_sendRawTransaction');
  });
});

describe('the CLI’s own bounds', () => {
  test('the chain-id check gives up after five seconds', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    const blackHole = await startBlackHole(t);

    const started = Date.now();
    const result = await workspace.run(['chain', 'set', 'hang', blackHole.url, '-p', 'work']);
    const elapsed = Date.now() - started;

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no response in 5000ms');
    expect(elapsed).toBeGreaterThanOrEqual(5_000);
    expect(elapsed).toBeLessThan(15_000);
    expect(await workspace.read('config/profiles/work.yaml')).toBe(EMPTY_PROFILE);
  });

  test('a refused connection is reported without waiting for a timeout', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);

    const started = Date.now();
    const result = await workspace.run(['chain', 'set', 'gone', REFUSED_URL, '-p', 'work']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Could not read the chain id');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('a timeout is reported rather than retried', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    const blackHole = await startBlackHole(t);

    const result = await workspace.run(['chain', 'set', 'hang', blackHole.url, '-p', 'work']);

    expect(result.stderr.match(/no response in 5000ms/g)).toHaveLength(1);
  });
});

describe('a run that reaches its own end', () => {
  test('uses one of the two exit codes and no signal', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);

    for (const args of [
      ['chain', 'list', '-p', 'work'],
      ['chain', 'list', '-p', 'nowhere'],
      ['wallet', 'address', 'NOT_SET_ANYWHERE'],
      ['--version'],
    ]) {
      const result = await workspace.run(args);
      expect([0, 1], `evm ${args.join(' ')}`).toContain(result.code);
      expect(result.signal).toBeNull();
    }
  });
});
