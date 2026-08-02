/**
 * Characterization: operations that fail — a profile the parser rejects, a chain
 * that cannot be reached, a warning that changes nothing.
 *
 * The distinction this file pins is the one REQ-007 draws: a profile the parser
 * rejects stops the command with exit 1, while a chain that fails inside a
 * fan-out is a row in the result and the command still exits 0.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { REFUSED_URL } from '../helpers/rpc-stub.js';
import { SOME_ADDRESS, createWorkspace, parseJson, row } from '../helpers/cli.js';

interface OwnerRow {
  chain: string;
  chainId: number;
  address: string;
  owner?: string;
  error?: string;
}

const BROKEN_CHAINS = `chains:
  refused:
    chain_id: 31337
    rpc_url: ${REFUSED_URL}
  nourl:
    chain_id: 5
  noid:
    rpc_url: ${REFUSED_URL}
  unsetref:
    chain_id: 7
    rpc_url: \${MISSING_RPC_URL}
  badurl:
    chain_id: 8
    rpc_url: http://host/rpc|a|b
`;

describe('a profile the parser rejects', () => {
  // REQ-028, REQ-029, REQ-032
  const cases: [string, string, (profilesDir: string) => string][] = [
    [
      'a top-level key that is not chains',
      'chainz:\n  base: {}\n',
      (dir) => `Invalid profile ${dir}/broken.yaml: expected a top-level 'chains' mapping\n`,
    ],
    [
      'an unknown field on a chain entry',
      'chains:\n  base:\n    chain_id: 1\n    rpc_urls: x\n',
      (dir) => `Invalid profile: chain 'base' in ${dir}/broken.yaml has unknown field 'rpc_urls'\n`,
    ],
    [
      'a quoted chain_id',
      'chains:\n  base:\n    chain_id: "1"\n    rpc_url: x\n',
      (dir) => `Invalid profile: chain 'base' in ${dir}/broken.yaml has a non-numeric chain_id\n`,
    ],
    [
      'a chain name with no mapping under it',
      'chains:\n  base: 42\n',
      (dir) =>
        `Invalid profile: chain 'base' in ${dir}/broken.yaml ` +
        'must be a mapping with chain_id and rpc_url\n',
    ],
    [
      'a non-mapping headers block',
      'chains:\n  base:\n    chain_id: 1\n    rpc_url: x\n    headers: [a]\n',
      (dir) => `Invalid profile: chain 'base' in ${dir}/broken.yaml has a non-mapping headers\n`,
    ],
    [
      'an unknown explorer',
      'chains:\n  base:\n    chain_id: 1\n    rpc_url: x\nexplorers:\n  etherscn: k\n',
      (dir) =>
        `Invalid profile ${dir}/broken.yaml: unknown explorer 'etherscn' ` +
        '(known: etherscan, blockscout)\n',
    ],
  ];

  for (const [name, contents, expected] of cases) {
    test(`${name} stops the command with exit 1`, async (t) => {
      const workspace = await createWorkspace(t);
      await workspace.write('config/profiles/broken.yaml', contents);

      const result = await workspace.run(['chain', 'list', '-p', 'broken']);

      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, expected(workspace.profilesDir));
    });
  }

  // REQ-028: an unrecognised top-level key is ignored rather than rejected
  test('an unrecognised top-level key alongside chains is ignored', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/extra.yaml',
      'rpc_timeout: 30\nchains:\n  base:\n    chain_id: 1\n    rpc_url: x\n'
    );

    const result = await workspace.run(['chain', 'list', '-p', 'extra', '--json']);

    assert.equal(result.code, 0);
    assert.deepEqual(
      Object.keys(parseJson<{ chains: Record<string, unknown> }>(result.stdout).chains),
      ['base']
    );
  });

  // A YAML syntax error surfaces the parser's own multi-line message, and unlike
  // every other profile error it does not name the file it came from. REQ-133's
  // acceptance was extended on 2026-08-01 to cover the messages the CLI relays
  // rather than composes: this one is catalogued as its own section of
  // docs/troubleshooting.md, including how to find which profile it came from.
  test('a YAML syntax error surfaces as the parser wrote it, naming no file', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/broken.yaml', 'chains: [1, 2\n');

    const result = await workspace.run(['chain', 'list', '-p', 'broken']);

    assert.equal(result.code, 1);
    assert.ok(
      result.stderr.startsWith(
        'Flow sequence in block collection must be sufficiently indented and end with a ]'
      ),
      result.stderr
    );
    assert.ok(!result.stderr.includes('broken.yaml'), 'the message names no file');
    assert.ok(result.stderr.split('\n').length > 2, 'the message spans several lines');
  });

  // REQ-133, as above: a filesystem error reaches the operator as the Node error
  // string, catalogued since 2026-08-01 as its own section rather than as a table
  // row, since EACCES and EISDIR have no fixed verbatim form.
  test('a filesystem error surfaces as the operating system wrote it', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/isdir.yaml/keep', '');

    const result = await workspace.run(['chain', 'list', '-p', 'isdir']);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'EISDIR: illegal operation on a directory, read\n');
  });

  // REQ-040: one broken profile does not hide the others
  test('profile list reports a broken profile in place and still exits 0', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/broken.yaml', 'chainz: {}\n');
    await workspace.write(
      'config/profiles/fine.yaml',
      'chains:\n  base:\n    chain_id: 1\n    rpc_url: x\n'
    );

    const result = await workspace.run(['profile', 'list', '--json']);

    assert.equal(result.code, 0);
    const parsed = parseJson<{ profiles: { name: string; chains?: number; error?: string }[] }>(
      result.stdout
    );
    const broken = parsed.profiles.find((profile) => profile.name === 'broken');
    const fine = parsed.profiles.find((profile) => profile.name === 'fine');
    assert.equal(
      broken?.error,
      `Invalid profile ${workspace.profilesDir}/broken.yaml: expected a top-level 'chains' mapping`
    );
    assert.equal(fine?.chains, 1);

    const table = await workspace.run(['profile', 'list']);
    assert.ok(row(table.stdout, 'broken')?.includes('error'), table.stdout);
  });
});

describe('a chain that fails inside a fan-out', () => {
  // REQ-007, REQ-030, REQ-031, REQ-072
  test('every way a chain can fail becomes a row, and the command exits 0', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/broken.yaml', BROKEN_CHAINS);

    const result = await workspace.run([
      'contract', 'owner', SOME_ADDRESS, '-p', 'broken', '-c',
      'refused,nourl,noid,unsetref,badurl,ghost', '--json',
    ]);

    assert.equal(result.code, 0);
    const rows = parseJson<OwnerRow[]>(result.stdout);
    const errors = Object.fromEntries(rows.map((entry) => [entry.chain, entry.error]));

    assert.match(errors.refused ?? '', /ECONNREFUSED/);
    assert.equal(errors.nourl, 'No RPC URL configured (evm chain set nourl <rpc-url>)');
    assert.equal(errors.noid, 'No chain_id set (evm chain set noid <rpc-url>)');
    assert.equal(errors.unsetref, 'Environment variable MISSING_RPC_URL not set');
    assert.equal(
      errors.badurl,
      'Invalid RPC URL: expected <URL> or <URL>|<AUTH_KEY>, got: http://host/rpc|a|b'
    );
    assert.equal(errors.ghost, "Not in profile 'broken' (evm chain set ghost <rpc-url>)");
  });

  // REQ-007: including when every selected chain failed
  test('the same failures render as table rows on stdout', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/broken.yaml', BROKEN_CHAINS);

    const result = await workspace.run(['contract', 'owner', SOME_ADDRESS, '-p', 'broken']);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.ok(row(result.stdout, 'nourl')?.endsWith('No RPC URL configured (evm chain set nourl <rpc-url>)'));
    assert.ok(row(result.stdout, 'noid')?.endsWith('No chain_id set (evm chain set noid <rpc-url>)'));
  });

  // REQ-007: a fan-out read where nothing worked still exits 0
  test('wallet balance reports failures per chain and exits 0', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/broken.yaml', BROKEN_CHAINS);

    const result = await workspace.run([
      'wallet', 'balance', SOME_ADDRESS, '-p', 'broken', '--no-usd', '--json',
    ]);

    assert.equal(result.code, 0);
    const rows = parseJson<{ error?: string; balance: string; nonce: number }[]>(result.stdout);
    assert.equal(rows.length, 5);
    for (const entry of rows) {
      assert.ok(entry.error, 'every row carries an error');
      assert.equal(entry.balance, '0');
      assert.equal(entry.nonce, 0);
    }
  });

  // REQ-069
  test('an unknown -xc name warns on stderr and changes nothing', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/broken.yaml', BROKEN_CHAINS);

    const result = await workspace.run([
      'contract', 'owner', SOME_ADDRESS, '-p', 'broken', '-xc', 'ghost,refused', '--json',
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "Warning: excluded chain 'ghost' is not in profile 'broken'\n");
    assert.deepEqual(
      parseJson<OwnerRow[]>(result.stdout).map((entry) => entry.chain),
      ['nourl', 'noid', 'unsetref', 'badurl']
    );
  });
});

describe('a write that never happens', () => {
  // REQ-051: the endpoint is asked for the chain id, and a failure is fatal
  test('chain set against an unreachable endpoint writes nothing', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', 'chains: {}\n');

    const result = await workspace.run([
      'chain', 'set', 'local', REFUSED_URL, '-p', 'work',
    ]);

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      new RegExp(
        `^Could not read the chain id from ${REFUSED_URL}: .*\n` +
          'Pass --no-verify --chain-id <id> to write the entry anyway\\.\n$'
      )
    );
    assert.equal(await workspace.read('config/profiles/work.yaml'), 'chains: {}\n');
  });

  // REQ-018: a reference is resolved before the endpoint is built, so an unset one
  // fails with the same escape hatch
  test('chain set with an unresolvable reference writes nothing', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', 'chains: {}\n');

    const result = await workspace.run([
      'chain', 'set', 'local', '${MISSING_RPC_URL}', '-p', 'work',
    ]);

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      'Environment variable MISSING_RPC_URL not set\n' +
        'Pass --no-verify --chain-id <id> to write the entry anyway.\n'
    );
    assert.equal(await workspace.read('config/profiles/work.yaml'), 'chains: {}\n');
  });
});

describe('which stream a line goes to', () => {
  // REQ-006 puts results on stdout and diagnostics on stderr. The two closing
  // lines of `profile list` fall on either side of that: the legend is part of
  // the answer (REQ-027, REQ-039), and the missing-default warning is a report
  // about the machine's state, so the table stays redirectable on its own.
  test('profile list keeps the legend on stdout and the missing-default warning on stderr', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write(
      'config/profiles/alpha.yaml',
      'chains:\n  base:\n    chain_id: 1\n    rpc_url: x\n'
    );

    const missing = await workspace.run(['profile', 'list'], {
      env: { EVM_ELF_PROFILE: 'ghost' },
    });
    assert.equal(missing.code, 0);
    assert.equal(
      missing.stderr,
      `Default profile 'ghost' is missing: ${workspace.profilesDir}/ghost.yaml\n`
    );
    assert.ok(!missing.stdout.includes('is missing'));
    assert.ok(missing.stdout.includes('alpha'), 'the table is still printed');

    const present = await workspace.run(['profile', 'list'], {
      env: { EVM_ELF_PROFILE: 'alpha' },
    });
    assert.equal(present.stderr, '');
    assert.ok(present.stdout.includes('* in use: alpha (from $EVM_ELF_PROFILE)'));

    const json = await workspace.run(['profile', 'list', '--json'], {
      env: { EVM_ELF_PROFILE: 'ghost' },
    });
    assert.equal(parseJson<{ default: string }>(json.stdout).default, 'ghost');
    assert.ok(!json.stdout.includes('is missing'));
  });
});
