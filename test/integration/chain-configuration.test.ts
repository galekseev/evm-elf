/**
 * Integration: the `chain` group against a real profile file and a real
 * endpoint.
 *
 * The boundary under test is the one between Commander's parsed options, the
 * YAML document editor, and the RPC round-trip that supplies the chain id. All
 * three are real here; only the node is a stub, and it is a stub because it is
 * a network.
 */

import { describe, expect, test } from 'vitest';
import { createRunner } from '../helpers/inprocess.js';
import { REFUSED_URL, startRpcStub } from '../helpers/rpc-stub.js';

const EMPTY_PROFILE = 'chains: {}\n';

describe('chain set', () => {
  test('reads the chain id from the endpoint and writes the entry', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);
    const stub = await startRpcStub(t, { chainId: 8453 });

    const result = await runner.invoke(['chain', 'set', 'base', stub.url]);

    expect(result.code).toBe(0);
    expect(stub.methods()).toContain('eth_chainId');
    expect(await runner.read('config/profiles/default.yaml')).toContain('chain_id: 8453');
  });

  test('fills in the metadata the endpoint cannot supply from the bundled profile', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);
    const stub = await startRpcStub(t, { chainId: 8453 });

    await runner.invoke(['chain', 'set', 'whatever-i-call-it', stub.url]);

    const written = await runner.read('config/profiles/default.yaml');
    expect(written).toContain('symbol: ETH');
    expect(written).toContain('coingecko_id: ethereum');
  });

  test('a header given on the command line reaches the endpoint', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);
    const stub = await startRpcStub(t, { chainId: 1 });

    const result = await runner.invoke([
      'chain', 'set', 'mainnet', stub.url, '--header', 'x-api-key: secret',
    ]);

    expect(result.code).toBe(0);
    expect(stub.calls[0].headers['x-api-key']).toBe('secret');
    expect(await runner.read('config/profiles/default.yaml')).toContain('x-api-key: secret');
  });

  test('an endpoint that cannot be reached leaves the profile alone', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);

    const result = await runner.invoke(['chain', 'set', 'base', REFUSED_URL]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Could not read the chain id');
    expect(await runner.read('config/profiles/default.yaml')).toBe(EMPTY_PROFILE);
  });

  test('a chain id that disagrees with the endpoint is refused and nothing is written', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);
    const stub = await startRpcStub(t, { chainId: 8453 });

    const result = await runner.invoke(['chain', 'set', 'base', stub.url, '--chain-id', '1']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('reports 8453, expected 1');
    expect(await runner.read('config/profiles/default.yaml')).toBe(EMPTY_PROFILE);
  });

  test('--no-verify writes the entry without contacting anything', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);

    const result = await runner.invoke([
      'chain', 'set', 'offline', 'https://rpc.example.invalid', '--no-verify', '--chain-id', '1',
    ]);

    expect(result.code).toBe(0);
    expect(await runner.read('config/profiles/default.yaml')).toContain('chain_id: 1');
  });

  test('an edit keeps the comments around the entry it touched', async (t) => {
    const runner = await createRunner(t);
    await runner.write(
      'config/profiles/default.yaml',
      [
        '# the profile the deploy scripts read',
        '',
        'chains:',
        '  # the one that matters',
        '  base:',
        '    chain_id: 8453',
        '    rpc_url: https://old.example.invalid',
        '  # and its neighbour',
        '  mainnet:',
        '    chain_id: 1',
        '    rpc_url: https://mainnet.example.invalid',
        '',
      ].join('\n')
    );
    const stub = await startRpcStub(t, { chainId: 8453 });

    await runner.invoke(['chain', 'set', 'base', stub.url]);

    const written = await runner.read('config/profiles/default.yaml');
    expect(written).toContain('# the profile the deploy scripts read');
    expect(written).toContain('# the one that matters');
    expect(written).toContain('# and its neighbour');
    expect(written).toContain(stub.url);
  });
});

describe('chain remove', () => {
  test('takes the chain out and leaves the rest of the file alone', async (t) => {
    const runner = await createRunner(t);
    await runner.write(
      'config/profiles/default.yaml',
      'chains:\n  base:\n    chain_id: 8453\n  mainnet:\n    chain_id: 1\n'
    );

    const result = await runner.invoke(['chain', 'remove', 'base']);

    expect(result.code).toBe(0);
    const written = await runner.read('config/profiles/default.yaml');
    expect(written).not.toContain('base');
    expect(written).toContain('mainnet');
  });

  test('removing a chain that is not there is refused', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'chains:\n  base:\n    chain_id: 8453\n');

    const result = await runner.invoke(['chain', 'remove', 'nowhere']);

    expect(result.code).toBe(1);
    expect(await runner.read('config/profiles/default.yaml')).toContain('base');
  });

  test('--json names the profile it edited and the chain it took out', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'chains:\n  base:\n    chain_id: 8453\n');

    const result = await runner.invoke(['chain', 'remove', 'base', '--json']);

    expect(JSON.parse(result.stdout)).toMatchObject({
      profile: 'default',
      path: runner.path('config', 'profiles', 'default.yaml'),
      removed: 'base',
    });
  });

  test('refuses to edit a profile that does not exist rather than creating one', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['chain', 'remove', 'base', '-p', 'nowhere']);

    expect(result.code).toBe(1);
    expect(await runner.exists('config/profiles/nowhere.yaml')).toBe(false);
  });
});

describe('chain list', () => {
  test('--json carries the stored configuration and the file it came from', async (t) => {
    const runner = await createRunner(t);
    await runner.write(
      'config/profiles/default.yaml',
      'chains:\n  base:\n    chain_id: 8453\n    rpc_url: https://example.invalid\n'
    );

    const result = await runner.invoke(['chain', 'list', '--json']);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      profile: 'default',
      path: runner.path('config', 'profiles', 'default.yaml'),
      chains: { base: { chain_id: 8453, rpc_url: 'https://example.invalid' } },
    });
  });

  test('the table masks a literal header value and prints a reference as written', async (t) => {
    const runner = await createRunner(t);
    await runner.write(
      'config/profiles/default.yaml',
      [
        'chains:',
        '  secret:',
        '    chain_id: 1',
        '    rpc_url: https://example.invalid',
        '    headers:',
        '      auth-key: abcdefghij',
        '  referenced:',
        '    chain_id: 2',
        '    rpc_url: https://example.invalid',
        '    headers:',
        '      auth-key: ${SOME_KEY}',
        '',
      ].join('\n')
    );

    const result = await runner.invoke(['chain', 'list'], { env: { SOME_KEY: 'live-value' } });

    expect(result.stdout).toContain('****ghij');
    expect(result.stdout).not.toContain('abcdefghij');
    expect(result.stdout).toContain('${SOME_KEY}');
    expect(result.stdout).not.toContain('live-value');
  });

  test('--reveal prints the literal in full', async (t) => {
    const runner = await createRunner(t);
    await runner.write(
      'config/profiles/default.yaml',
      [
        'chains:',
        '  secret:',
        '    chain_id: 1',
        '    rpc_url: https://example.invalid',
        '    headers:',
        '      auth-key: abcdefghij',
        '',
      ].join('\n')
    );

    const result = await runner.invoke(['chain', 'list', '--reveal']);

    expect(result.stdout).toContain('abcdefghij');
  });
});
