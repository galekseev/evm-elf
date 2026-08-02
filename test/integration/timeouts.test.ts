/**
 * Integration: the bounds the CLI puts on an endpoint that never answers.
 *
 * The characterization suite already pins the five-second chain-id bound, and
 * pays five real seconds for it. Here the clock is the only thing faked — the
 * socket is a real one that accepts the connection and stays silent — so the
 * same bound can be asserted, and the *number* checked, without the wait.
 *
 * Only `setTimeout` is replaced. Faking Date as well would freeze the clock
 * ethers and the socket layer read, and the test would be measuring the fake
 * rather than the code.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createRunner } from '../helpers/inprocess.js';
import { startBlackHole, startRpcStub } from '../helpers/rpc-stub.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('chain set against a silent endpoint', () => {
  test('gives up after five seconds and writes nothing', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'chains: {}\n');
    const blackHole = await startBlackHole(t);

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const running = runner.invoke(['chain', 'set', 'hang', blackHole.url]);

    await blackHole.connected;
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await running;

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no response in 5000ms');
    expect(result.stderr).toContain('--no-verify --chain-id');
    expect(await runner.read('config/profiles/default.yaml')).toBe('chains: {}\n');
  });

  test('has not given up a millisecond before the bound', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'chains: {}\n');
    const blackHole = await startBlackHole(t);

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const running = runner.invoke(['chain', 'set', 'hang', blackHole.url]);

    await blackHole.connected;
    await vi.advanceTimersByTimeAsync(4_999);
    const settled = await Promise.race([running.then(() => 'settled'), Promise.resolve('pending')]);
    expect(settled).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    expect((await running).code).toBe(1);
  });

  test('an endpoint that does answer is not waited on at all', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'chains: {}\n');
    const stub = await startRpcStub(t, { chainId: 8453 });

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const result = await runner.invoke(['chain', 'set', 'base', stub.url]);

    expect(result.code).toBe(0);
    expect(await runner.read('config/profiles/default.yaml')).toContain('chain_id: 8453');
  });
});
