/**
 * Characterization: arguments the CLI refuses, and the wording it refuses them
 * with.
 *
 * Everything here fails before a chain is contacted, so the whole file runs
 * offline. Each case also asserts that nothing was written, since REQ-046,
 * REQ-059 and REQ-067 make "exits 1 exactly when it changed nothing" the
 * contract these messages sit behind.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { KEYS, SOME_ADDRESS, createWorkspace, profileYaml } from '../helpers/cli.js';

const ONE_CHAIN = profileYaml({ solo: { chain_id: 31337, rpc_url: 'http://127.0.0.1:8545' } });

describe('parser-level refusals', () => {
  // REQ-008: three option pairs are rejected by commander, before any command body
  test('-c cannot be combined with -xc', async (t) => {
    const workspace = await createWorkspace(t);

    for (const command of [
      ['wallet', 'balance', SOME_ADDRESS],
      ['contract', 'owner', SOME_ADDRESS],
      ['contract', 'code', SOME_ADDRESS],
      ['contract', 'proxy-info', SOME_ADDRESS],
    ]) {
      const result = await workspace.run([...command, '-c', 'a', '-xc', 'b']);
      assert.equal(result.code, 1, command.join(' '));
      assert.equal(
        result.stderr,
        "error: option '-xc, --exclude-chain <chains>' cannot be used with option '-c, --chain <chains>'\n"
      );
    }
  });

  // REQ-008
  test('--value cannot be combined with --all, nor --fee-buffer with --value', async (t) => {
    const workspace = await createWorkspace(t);

    const valueAndAll = await workspace.run([
      'wallet', 'send', SOME_ADDRESS, '--value', '1', '--all', '--private-key', KEYS.one.key,
    ]);
    assert.equal(valueAndAll.code, 1);
    assert.equal(
      valueAndAll.stderr,
      "error: option '--value <amount>' cannot be used with option '--all'\n"
    );

    const bufferAndValue = await workspace.run([
      'wallet', 'send', SOME_ADDRESS, '--value', '1', '--fee-buffer', '1.5',
      '--private-key', KEYS.one.key,
    ]);
    assert.equal(bufferAndValue.code, 1);
    assert.equal(
      bufferAndValue.stderr,
      "error: option '--fee-buffer <multiplier>' cannot be used with option '--value <amount>'\n"
    );
  });

  test('a required option and a required argument each have their own wording', async (t) => {
    const workspace = await createWorkspace(t);

    const missingOption = await workspace.run(['wallet', 'send', SOME_ADDRESS, '--value', '1']);
    assert.equal(missingOption.stderr, "error: required option '--private-key <key>' not specified\n");

    const missingArgument = await workspace.run(['wallet', 'address']);
    assert.equal(missingArgument.stderr, "error: missing required argument 'private-key'\n");

    const missingChain = await workspace.run([
      'contract', 'transfer-ownership', SOME_ADDRESS, SOME_ADDRESS, '--private-key', KEYS.one.key,
    ]);
    assert.equal(missingChain.stderr, "error: required option '-c, --chain <chain>' not specified\n");
  });
});

describe('chain configuration arguments', () => {
  test('an unusable chain name is refused before the profile is touched', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', ONE_CHAIN);

    const result = await workspace.run([
      'chain', 'set', 'bad name!', 'http://127.0.0.1:8545', '--chain-id', '1', '--no-verify',
      '-p', 'work',
    ]);

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      "Invalid chain name 'bad name!': use letters, digits, '.', '_' or '-'\n"
    );
    assert.equal(await workspace.read('config/profiles/work.yaml'), ONE_CHAIN);
  });

  // REQ-059
  test('a new chain with no RPC URL is refused', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', ONE_CHAIN);

    const result = await workspace.run([
      'chain', 'set', 'fresh', '--chain-id', '1', '--no-verify', '-p', 'work',
    ]);

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `Chain 'fresh' is not in ${workspace.profilesDir}/work.yaml: ` +
        'pass an RPC URL (evm chain set fresh <rpc-url>)\n'
    );
    assert.equal(await workspace.read('config/profiles/work.yaml'), ONE_CHAIN);
  });

  // REQ-053
  test('--no-verify without --chain-id is refused', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', ONE_CHAIN);

    const result = await workspace.run([
      'chain', 'set', 'fresh', 'http://127.0.0.1:8545', '--no-verify', '-p', 'work',
    ]);

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      '--no-verify needs --chain-id, since the chain id cannot be read from the RPC\n'
    );
    assert.equal(await workspace.read('config/profiles/work.yaml'), ONE_CHAIN);
  });

  test('a --chain-id that is not a positive integer is refused', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', ONE_CHAIN);

    for (const value of ['0', '-3', 'abc', '1.5']) {
      const result = await workspace.run([
        'chain', 'set', 'fresh', 'http://127.0.0.1:8545', '--chain-id', value, '--no-verify',
        '-p', 'work',
      ]);
      assert.equal(result.code, 1, value);
      assert.equal(
        result.stderr,
        `Invalid --chain-id '${value}': expected a positive integer\n`
      );
    }
    assert.equal(await workspace.read('config/profiles/work.yaml'), ONE_CHAIN);
  });

  // REQ-056
  test('a header argument without a name and a value is refused', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', ONE_CHAIN);

    for (const header of ['nocolon', ':value', 'name:', ':']) {
      const result = await workspace.run([
        'chain', 'set', 'solo', '--chain-id', '31337', '--no-verify', '-p', 'work', '-H', header,
      ]);
      assert.equal(result.code, 1, header);
      assert.equal(result.stderr, `Invalid --header '${header}': expected <name>:<value>\n`);
    }
    assert.equal(await workspace.read('config/profiles/work.yaml'), ONE_CHAIN);
  });
});

describe('explorer arguments', () => {
  // REQ-061
  test('an unknown explorer name is refused by set and by remove', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', ONE_CHAIN);
    const message = "Unknown explorer 'etherscn': known explorers are etherscan, blockscout\n";

    const set = await workspace.run([
      'explorer', 'set', 'etherscn', 'key', '--no-verify', '-p', 'work',
    ]);
    assert.equal(set.code, 1);
    assert.equal(set.stderr, message);

    const remove = await workspace.run(['explorer', 'remove', 'etherscn', '-p', 'work']);
    assert.equal(remove.code, 1);
    assert.equal(remove.stderr, message);
    assert.equal(await workspace.read('config/profiles/work.yaml'), ONE_CHAIN);
  });

  // REQ-067
  test('an empty or whitespace-only key is refused', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', ONE_CHAIN);

    for (const key of ['', '   ']) {
      const result = await workspace.run([
        'explorer', 'set', 'etherscan', key, '--no-verify', '-p', 'work',
      ]);
      assert.equal(result.code, 1, JSON.stringify(key));
      assert.equal(
        result.stderr,
        "Empty API key for 'etherscan': pass a key, or remove it with evm explorer remove etherscan\n"
      );
    }
    assert.equal(await workspace.read('config/profiles/work.yaml'), ONE_CHAIN);
  });

  // REQ-063: an unresolvable reference cannot be checked, so it is refused
  test('a ${VAR} key whose variable is unset is refused unless --no-verify', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', ONE_CHAIN);

    const refused = await workspace.run([
      'explorer', 'set', 'etherscan', '${ETHERSCAN_API_KEY}', '-p', 'work',
    ]);
    assert.equal(refused.code, 1);
    assert.equal(
      refused.stderr,
      'Could not resolve ${ETHERSCAN_API_KEY}: the environment variable is not set\n' +
        'Pass --no-verify to write the entry anyway.\n'
    );
    assert.equal(await workspace.read('config/profiles/work.yaml'), ONE_CHAIN);

    const written = await workspace.run([
      'explorer', 'set', 'etherscan', '${ETHERSCAN_API_KEY}', '--no-verify', '-p', 'work',
    ]);
    assert.equal(written.code, 0);
    assert.match(await workspace.read('config/profiles/work.yaml'), /etherscan: \$\{ETHERSCAN_API_KEY\}/);
  });
});

describe('wallet and contract arguments', () => {
  test('wallet generate takes 12 or 24 words and nothing else', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['wallet', 'generate', '--words', '13']);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, '--words must be 12 or 24, got: 13\n');
  });

  test('a target nonce must be a non-negative integer', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run([
      'wallet', 'set-nonce', 'abc', '--private-key', KEYS.one.key,
    ]);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'Target nonce must be a non-negative integer, got: abc\n');
  });

  test('an address argument is checked before anything else happens', async (t) => {
    const workspace = await createWorkspace(t);

    const cases: [string[], string][] = [
      [['contract', 'owner', 'notanaddress'], 'Invalid Ethereum address: notanaddress\n'],
      [['contract', 'code', 'notanaddress'], 'Invalid Ethereum address: notanaddress\n'],
      [['contract', 'proxy-info', 'notanaddress'], 'Invalid Ethereum address: notanaddress\n'],
      [
        ['wallet', 'send', 'notanaddress', '--value', '1', '--private-key', KEYS.one.key],
        'Invalid recipient address: notanaddress\n',
      ],
      [
        [
          'contract', 'transfer-ownership', 'notanaddress', SOME_ADDRESS,
          '-c', 'solo', '--private-key', KEYS.one.key,
        ],
        'Invalid contract address: notanaddress\n',
      ],
      [
        [
          'contract', 'transfer-ownership', SOME_ADDRESS, 'notanaddress',
          '-c', 'solo', '--private-key', KEYS.one.key,
        ],
        'Invalid new owner address: notanaddress\n',
      ],
      [
        [
          'contract', 'proxy-upgrade', 'notanaddress', SOME_ADDRESS,
          '-c', 'solo', '--private-key', KEYS.one.key,
        ],
        'Invalid proxy address: notanaddress\n',
      ],
      [
        [
          'contract', 'proxy-upgrade', SOME_ADDRESS, 'notanaddress',
          '-c', 'solo', '--private-key', KEYS.one.key,
        ],
        'Invalid implementation address: notanaddress\n',
      ],
    ];

    for (const [args, message] of cases) {
      const result = await workspace.run(args);
      assert.equal(result.code, 1, args.join(' '));
      assert.equal(result.stderr, message, args.join(' '));
    }
    assert.deepEqual(await workspace.tree('config'), []);
  });

  test('wallet send needs an amount, and refuses --no-wait without --exec', async (t) => {
    const workspace = await createWorkspace(t);

    const noAmount = await workspace.run([
      'wallet', 'send', SOME_ADDRESS, '--private-key', KEYS.one.key,
    ]);
    assert.equal(noAmount.stderr, 'send requires either --value <amount> or --all\n');

    const noWait = await workspace.run([
      'wallet', 'send', SOME_ADDRESS, '--value', '1', '--no-wait', '--private-key', KEYS.one.key,
    ]);
    assert.equal(
      noWait.stderr,
      '--no-wait has no effect without --exec: a plan sends nothing\n'
    );

    const badValue = await workspace.run([
      'wallet', 'send', SOME_ADDRESS, '--value', 'abc', '--private-key', KEYS.one.key,
    ]);
    assert.equal(badValue.stderr, 'Invalid --value: abc\n');

    const badBuffer = await workspace.run([
      'wallet', 'send', SOME_ADDRESS, '--all', '--fee-buffer', '0.5', '--private-key', KEYS.one.key,
    ]);
    assert.equal(badBuffer.stderr, 'Invalid --fee-buffer: 0.5 (must be a number >= 1)\n');
  });

  test('a send with nothing to send on says so', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/empty.yaml', 'chains: {}\n');

    const result = await workspace.run([
      'wallet', 'send', SOME_ADDRESS, '--value', '1', '--private-key', KEYS.one.key,
      '-p', 'empty',
    ]);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'No chains selected\n');
  });

  // REQ-073
  test('the two single-chain commands reject a comma-separated -c', async (t) => {
    const workspace = await createWorkspace(t);

    const transfer = await workspace.run([
      'contract', 'transfer-ownership', SOME_ADDRESS, SOME_ADDRESS,
      '-c', 'a,b', '--private-key', KEYS.one.key,
    ]);
    assert.equal(transfer.code, 1);
    assert.equal(transfer.stderr, 'transfer-ownership requires exactly one chain (-c <chain>)\n');

    const upgrade = await workspace.run([
      'contract', 'proxy-upgrade', SOME_ADDRESS, SOME_ADDRESS,
      '-c', 'a,b', '--private-key', KEYS.one.key,
    ]);
    assert.equal(upgrade.code, 1);
    assert.equal(upgrade.stderr, 'proxy-upgrade requires exactly one chain (-c <chain>)\n');
  });

  test('proxy-upgrade checks the shape of --data', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run([
      'contract', 'proxy-upgrade', SOME_ADDRESS, SOME_ADDRESS,
      '-c', 'solo', '--private-key', KEYS.one.key, '--data', 'zz',
    ]);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'Invalid --data: must be a 0x-prefixed hex string, got: zz\n');
  });

  test('proxy-info refuses -s together with --full', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['contract', 'proxy-info', SOME_ADDRESS, '-s', '--full']);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, '--short and --full are mutually exclusive\n');
  });

  test('contract code --full needs exactly one chain', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/two.yaml',
      profileYaml({
        one: { chain_id: 1, rpc_url: 'http://127.0.0.1:1' },
        two: { chain_id: 2, rpc_url: 'http://127.0.0.1:1' },
      })
    );

    const result = await workspace.run([
      'contract', 'code', SOME_ADDRESS, '-p', 'two', '--full',
    ]);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, '--full requires exactly one chain (use -c <chain>)\n');
  });
});
