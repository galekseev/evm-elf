/**
 * Integration: storing an explorer API key, and the check that happens before
 * it is stored.
 *
 * The multichain explorer endpoints are the one boundary a profile cannot
 * redirect — their addresses are compiled in — so this is where the fetch stub
 * earns its place. Everything else is real: the same profile document, the same
 * atomic write, the same masking.
 */

import { describe, expect, test } from 'vitest';
import {
  ETHERSCAN,
  etherscanOk,
  etherscanRejects,
  stubExternalHttp,
} from '../helpers/external-http.js';
import { createRunner } from '../helpers/inprocess.js';

const EMPTY_PROFILE = 'chains: {}\n';

/** The probe asks for a long-verified contract; answering it is what "accepted" means */
const accepts = { [ETHERSCAN]: () => etherscanOk([{ ContractName: 'WETH9', SourceCode: '...' }]) };

describe('explorer set', () => {
  test('checks the key against the explorer, then writes it', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);
    const external = stubExternalHttp(accepts);

    const result = await runner.invoke(['explorer', 'set', 'etherscan', 'a-real-key', '--json']);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      explorer: 'etherscan',
      added: true,
      verified: true,
    });
    expect(external.urls()[0]).toContain('apikey=a-real-key');
    expect(await runner.read('config/profiles/default.yaml')).toContain('etherscan: a-real-key');
  });

  test('a key the explorer rejects is not stored', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);
    stubExternalHttp({ [ETHERSCAN]: () => etherscanRejects('Invalid API Key') });

    const result = await runner.invoke(['explorer', 'set', 'etherscan', 'a-bad-key']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Invalid API Key');
    expect(await runner.read('config/profiles/default.yaml')).toBe(EMPTY_PROFILE);
  });

  test('an explorer that cannot be reached is not taken as acceptance', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);
    stubExternalHttp({
      [ETHERSCAN]: () => {
        throw new Error('the explorer is down');
      },
    });

    const result = await runner.invoke(['explorer', 'set', 'etherscan', 'a-key']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no usable response');
    expect(await runner.read('config/profiles/default.yaml')).toBe(EMPTY_PROFILE);
  });

  test('--no-verify writes without asking, and says the key was not checked', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);
    const external = stubExternalHttp({});

    const result = await runner.invoke(['explorer', 'set', 'etherscan', 'a-key', '--no-verify']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('not checked');
    expect(external.urls()).toEqual([]);
    expect(await runner.read('config/profiles/default.yaml')).toContain('etherscan: a-key');
  });

  test('a reference that cannot be resolved cannot be checked, so it is refused', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);

    const result = await runner.invoke(['explorer', 'set', 'etherscan', '${NOT_SET_ANYWHERE}']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('the environment variable is not set');
    expect(result.stderr).toContain('--no-verify');
  });

  test('a reference is resolved to reach the explorer and stored unresolved', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);
    const external = stubExternalHttp(accepts);

    await runner.invoke(['explorer', 'set', 'etherscan', '${ETHERSCAN_API_KEY}'], {
      env: { ETHERSCAN_API_KEY: 'the-live-key' },
    });

    expect(external.urls()[0]).toContain('apikey=the-live-key');
    const written = await runner.read('config/profiles/default.yaml');
    expect(written).toContain('etherscan: ${ETHERSCAN_API_KEY}');
    expect(written).not.toContain('the-live-key');
  });

  test('replacing an existing entry is reported as a replacement', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'explorers:\n  etherscan: old\nchains: {}\n');
    stubExternalHttp(accepts);

    const result = await runner.invoke(['explorer', 'set', 'etherscan', 'new-key', '--json']);

    expect(JSON.parse(result.stdout)).toMatchObject({ added: false });
  });

  test('refuses a source outside the two known ones', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);

    const result = await runner.invoke(['explorer', 'set', 'etherscan-v1', 'a-key']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('known explorers are etherscan, blockscout');
  });

  test('refuses an empty key, and names the way to clear one', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);

    const result = await runner.invoke(['explorer', 'set', 'etherscan', '   ']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('evm explorer remove etherscan');
  });

  test('masks the key it just stored', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);
    stubExternalHttp(accepts);

    const result = await runner.invoke(['explorer', 'set', 'etherscan', 'abcdefghij']);

    expect(result.stdout).toContain('****ghij');
    expect(result.stdout).not.toContain('abcdefghij');
  });
});

describe('explorer list and remove', () => {
  test('shows both sources, their endpoints and the order they are tried in', async (t) => {
    const runner = await createRunner(t);
    await runner.write(
      'config/profiles/default.yaml',
      'explorers:\n  etherscan: abcdefghij\n  blockscout: ${BLOCKSCOUT_KEY}\nchains: {}\n'
    );

    const result = await runner.invoke(['explorer', 'list']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('api.etherscan.io');
    expect(result.stdout).toContain('api.blockscout.com');
    expect(result.stdout.indexOf('etherscan')).toBeLessThan(result.stdout.indexOf('blockscout'));
  });

  test('the table masks a literal key and --json carries it in full', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'explorers:\n  etherscan: abcdefghij\nchains: {}\n');

    const table = await runner.invoke(['explorer', 'list']);
    expect(table.stdout).toContain('****ghij');
    expect(table.stdout).not.toContain('abcdefghij');

    const json = await runner.invoke(['explorer', 'list', '--json']);
    expect(json.stdout).toContain('abcdefghij');
  });

  test('remove takes the key out and leaves the chains alone', async (t) => {
    const runner = await createRunner(t);
    await runner.write(
      'config/profiles/default.yaml',
      'explorers:\n  etherscan: a-key\nchains:\n  base:\n    chain_id: 8453\n'
    );

    const result = await runner.invoke(['explorer', 'remove', 'etherscan']);

    expect(result.code).toBe(0);
    const written = await runner.read('config/profiles/default.yaml');
    expect(written).not.toContain('a-key');
    expect(written).toContain('base');
  });

  test('--json names what was removed', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'explorers:\n  etherscan: a-key\nchains: {}\n');

    const result = await runner.invoke(['explorer', 'remove', 'etherscan', '--json']);

    expect(JSON.parse(result.stdout)).toMatchObject({ removed: 'etherscan', profile: 'default' });
  });

  test('both sources are listed as not set when the profile configures neither', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);

    const result = await runner.invoke(['explorer', 'list']);

    expect(result.code).toBe(0);
    expect(result.stdout.match(/not set/g)).toHaveLength(2);
    expect(result.stdout).toContain('after a chain that names its own explorer_api');
  });

  test('removing a source outside the two known ones is refused', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', EMPTY_PROFILE);

    const result = await runner.invoke(['explorer', 'remove', 'etherscan-v1']);

    expect(result.code).toBe(1);
  });

  test('removing the same key twice is refused the second time', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/default.yaml', 'explorers:\n  etherscan: a-key\nchains: {}\n');

    expect((await runner.invoke(['explorer', 'remove', 'etherscan'])).code).toBe(0);
    expect((await runner.invoke(['explorer', 'remove', 'etherscan'])).code).toBe(1);
  });
});
