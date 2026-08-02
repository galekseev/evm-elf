/**
 * Characterization: every file the CLI creates or rewrites — what lands on disk,
 * with which permissions, and what survives an edit.
 *
 * Assertions here compare whole files rather than fragments, because the point
 * of the suite is to notice a formatting change nobody intended. Tests tagged
 * `[MISMATCH REQ-NNN]` record a conflict with the approved requirements
 * specification and pin the behaviour as it is today.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'vitest';
import {
  BUNDLED_CHAINS,
  BUNDLED_PROFILE_PATH,
  createWorkspace,
  denyWrites,
  parseJson,
} from '../helpers/cli.js';

// The blank line is deliberate: it makes the header a document comment, which
// `evm explorer set` leaves at the top of the file rather than pushing down
// with `chains`.
const EMPTY_PROFILE =
  '# evm-elf profile. Add chains with: evm chain set <chain> <rpc-url>\n\nchains: {}\n';

const COMMENTED_PROFILE = `# top comment

# about the chains
chains:
  # a comment about base
  base:
    chain_id: 8453
    rpc_url: https://mainnet.base.org # trailing on rpc_url
    symbol: ETH # trailing on symbol
  other:
    chain_id: 1
    rpc_url: https://example.invalid # untouched trailing
`;

const setBase = (profile: string, ...extra: string[]): string[] => [
  'chain',
  'set',
  'base',
  '--chain-id',
  '8453',
  '--no-verify',
  '-p',
  profile,
  ...extra,
];

describe('profile files', () => {
  // REQ-041, REQ-036
  test('profile create copies the bundled profile byte for byte, owner-only', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['profile', 'create', 'work']);

    assert.equal(result.code, 0);
    assert.equal(
      result.stdout,
      `Created profile work ${workspace.profilesDir}/work.yaml\n` +
        `  14 chains from the bundled profile: ${BUNDLED_CHAINS.join(', ')}\n` +
        '  use it with: -p work, or make it the default: evm profile set-default work\n'
    );
    assert.equal(
      await workspace.read('config/profiles/work.yaml'),
      await readFile(BUNDLED_PROFILE_PATH, 'utf-8')
    );
    assert.equal(await workspace.mode('config/profiles/work.yaml'), '600');
  });

  // REQ-041, REQ-036
  test('profile create --empty writes a placeholder with a document comment', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['profile', 'create', 'work', '--empty']);

    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes('empty — add chains with: evm chain set <chain> <rpc-url>'));
    assert.equal(await workspace.read('config/profiles/work.yaml'), EMPTY_PROFILE);
    assert.equal(await workspace.mode('config/profiles/work.yaml'), '600');
  });

  // REQ-042
  test('profile create refuses an existing target and leaves it alone', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', 'chains: {}\n');

    const result = await workspace.run(['profile', 'create', 'work']);

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `Profile already exists: ${workspace.profilesDir}/work.yaml\n`
    );
    assert.equal(await workspace.read('config/profiles/work.yaml'), 'chains: {}\n');
  });

  // REQ-043, REQ-037
  test('profile clone copies a file verbatim, from a name or a path', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/source.yaml', COMMENTED_PROFILE);
    await workspace.write('cwd/team-chains.yaml', COMMENTED_PROFILE);

    const byName = await workspace.run(['profile', 'clone', 'source', 'copy']);
    assert.equal(byName.code, 0);
    assert.equal(await workspace.read('config/profiles/copy.yaml'), COMMENTED_PROFILE);
    assert.equal(await workspace.mode('config/profiles/copy.yaml'), '600');

    const byPath = await workspace.run(['profile', 'clone', './team-chains.yaml', 'team']);
    assert.equal(byPath.code, 0);
    assert.equal(await workspace.read('config/profiles/team.yaml'), COMMENTED_PROFILE);
  });

  // REQ-043
  test('profile clone refuses an existing target, a missing source, and itself', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/source.yaml', EMPTY_PROFILE);
    await workspace.write('config/profiles/copy.yaml', 'chains: {}\n');

    const existing = await workspace.run(['profile', 'clone', 'source', 'copy']);
    assert.equal(existing.code, 1);
    assert.equal(
      existing.stderr,
      `Profile already exists: ${workspace.profilesDir}/copy.yaml (pass --force to overwrite)\n`
    );
    assert.equal(await workspace.read('config/profiles/copy.yaml'), 'chains: {}\n');

    const missing = await workspace.run(['profile', 'clone', 'ghost', 'copy2']);
    assert.equal(missing.code, 1);
    assert.equal(missing.stderr, `Profile not found: ${workspace.profilesDir}/ghost.yaml\n`);

    const itself = await workspace.run(['profile', 'clone', 'source', 'source']);
    assert.equal(itself.code, 1);
    assert.equal(itself.stderr, 'Source and target are the same file\n');

    const forced = await workspace.run(['profile', 'clone', 'source', 'copy', '--force']);
    assert.equal(forced.code, 0);
    assert.equal(await workspace.read('config/profiles/copy.yaml'), EMPTY_PROFILE);
    assert.equal(await workspace.mode('config/profiles/copy.yaml'), '600');
  });

  // REQ-044
  test('profile remove deletes the file and clears a pointer that named it', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    await workspace.run(['profile', 'set-default', 'work']);

    const result = await workspace.run(['profile', 'remove', 'work', '--force', '--json']);

    assert.deepEqual(parseJson(result.stdout), {
      removed: 'work',
      path: `${workspace.profilesDir}/work.yaml`,
      defaultCleared: true,
    });
    assert.equal(await workspace.exists('config/profiles/work.yaml'), false);
    assert.equal(await workspace.exists('config/profiles/.default'), false);
  });

  // REQ-044: removing `default` is allowed, and the next run recreates it
  test('the default profile can be removed and comes back on the next run', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.run(['chain', 'list']);

    const removed = await workspace.run(['profile', 'remove', 'default', '--force']);
    assert.equal(removed.code, 0);
    assert.ok(removed.stdout.includes('it will be recreated from the bundled profile on next use'));
    assert.equal(await workspace.exists('config/profiles/default.yaml'), false);

    await workspace.run(['chain', 'list']);
    assert.ok(await workspace.exists('config/profiles/default.yaml'));
  });
});

describe('chain edits', () => {
  // REQ-054: metadata comes from the bundled entry with the same chain id
  test('chain set fills symbol and coingecko_id from the bundled profile', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.run(['profile', 'create', 'work', '--empty']);

    const result = await workspace.run([
      'chain',
      'set',
      'base-backup',
      'http://127.0.0.1:8545',
      '--chain-id',
      '8453',
      '--no-verify',
      '-p',
      'work',
    ]);

    assert.equal(result.code, 0);
    assert.equal(
      result.stdout,
      `Added base-backup to ${workspace.profilesDir}/work.yaml\n` +
        '  chain_id     8453\n' +
        '  rpc_url      http://127.0.0.1:8545\n' +
        '  symbol       ETH\n' +
        '  coingecko_id ethereum\n'
    );
  });

  // Observed: an entry added to a profile whose `chains` mapping is in flow style
  // — which is what `profile create --empty` writes — stays in flow style, so the
  // whole mapping is one line however many chains it grows.
  test('an empty profile keeps its flow style as chains are added', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.run(['profile', 'create', 'work', '--empty']);

    await workspace.run(setBase('work', 'http://127.0.0.1:8545'));

    assert.equal(
      await workspace.read('config/profiles/work.yaml'),
      '# evm-elf profile. Add chains with: evm chain set <chain> <rpc-url>\n\n' +
        'chains: { base: { chain_id: 8453, rpc_url: http://127.0.0.1:8545, symbol: ETH, coingecko_id: ethereum } }\n'
    );
  });

  // REQ-037 preserves standalone comments and comments on untouched lines, and
  // states as a prohibition that a trailing comment on a field the command
  // rewrites is not preserved — `rpc_url` and `symbol` here, both of which
  // `chain set` always writes. Amended on 2026-08-01: the requirement previously
  // promised the file's comments without that qualification.
  test('chain set drops trailing comments on the fields it rewrites', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/c.yaml', COMMENTED_PROFILE);

    const result = await workspace.run(setBase('c'));

    assert.equal(result.code, 0);
    assert.equal(
      await workspace.read('config/profiles/c.yaml'),
      `# top comment

# about the chains
chains:
  # a comment about base
  base:
    chain_id: 8453
    rpc_url: https://mainnet.base.org
    symbol: ETH
    coingecko_id: ethereum
  other:
    chain_id: 1
    rpc_url: https://example.invalid # untouched trailing
`
    );
  });

  // REQ-055 clears a field with an empty value; clearing removes the key and
  // setting it again appends it, so `symbol` ends up after `coingecko_id` rather
  // than back where it was. REQ-037 was amended on 2026-08-01 to state that as a
  // prohibition: field order within an entry carries no meaning.
  test('clearing and re-setting a field moves it to the end of the entry', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/c.yaml', COMMENTED_PROFILE);

    await workspace.run(setBase('c', '--symbol', ''));
    assert.ok(!(await workspace.read('config/profiles/c.yaml')).includes('symbol:'));

    await workspace.run(setBase('c', '--symbol', 'ETH'));
    const after = await workspace.read('config/profiles/c.yaml');
    assert.ok(
      after.includes('    coingecko_id: ethereum\n    symbol: ETH\n'),
      `symbol did not move to the end:\n${after}`
    );
  });

  // REQ-055
  test('an explicit --symbol overrides both the entry and the bundled default', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/c.yaml', COMMENTED_PROFILE);

    const result = await workspace.run(setBase('c', '--symbol', 'ETC', '--json'));

    const written = parseJson<{ config: { symbol: string } }>(result.stdout);
    assert.equal(written.config.symbol, 'ETC');
  });

  // REQ-056
  test('headers merge on top of the entry, and removing the last one drops the key', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/c.yaml', COMMENTED_PROFILE);

    await workspace.run(setBase('c', '-H', 'a:1', '-H', 'b:2'));
    const withHeaders = await workspace.read('config/profiles/c.yaml');
    assert.ok(withHeaders.includes('    headers:\n      a: "1"\n      b: "2"\n'), withHeaders);

    const removed = await workspace.run(setBase('c', '--remove-header', 'a'));
    assert.ok(removed.stdout.includes('  headers      b'));

    await workspace.run(setBase('c', '--remove-header', 'b'));
    assert.ok(!(await workspace.read('config/profiles/c.yaml')).includes('headers'));
  });

  // REQ-058
  test('chain remove takes the entry out and lists what is configured on a miss', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/c.yaml', COMMENTED_PROFILE);

    const removed = await workspace.run(['chain', 'remove', 'other', '-p', 'c']);
    assert.equal(removed.code, 0);
    assert.equal(
      await workspace.read('config/profiles/c.yaml'),
      `# top comment

# about the chains
chains:
  # a comment about base
  base:
    chain_id: 8453
    rpc_url: https://mainnet.base.org # trailing on rpc_url
    symbol: ETH # trailing on symbol
`
    );

    const missing = await workspace.run(['chain', 'remove', 'other', '-p', 'c']);
    assert.equal(missing.code, 1);
    assert.equal(
      missing.stderr,
      `Chain 'other' is not in ${workspace.profilesDir}/c.yaml (configured: base)\n`
    );
  });
});

describe('explorer edits', () => {
  // REQ-037: the `explorers` section is created above `chains`, because it is two
  // lines and should not sit below every chain. What that does to a leading
  // comment is the YAML comment model rather than a choice — here every comment
  // is part of the run flush against `chains:`, so all of it belongs to that key
  // and moves with it. A header followed by a blank line, with nothing between it
  // and the key, stays at the top; that is what `profile create --empty` writes.
  test('explorer set inserts the section above a comment that belongs to chains', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/c.yaml', COMMENTED_PROFILE);

    const result = await workspace.run([
      'explorer',
      'set',
      'etherscan',
      'literalkey1234',
      '--no-verify',
      '-p',
      'c',
    ]);

    assert.equal(result.code, 0);
    assert.equal(
      result.stdout,
      `Added etherscan to ${workspace.profilesDir}/c.yaml\n` +
        '  api_key      ****1234\n' +
        '  key not checked (--no-verify)\n'
    );
    const written = await workspace.read('config/profiles/c.yaml');
    assert.ok(written.startsWith('explorers:\n  etherscan: literalkey1234\n# top comment\n'), written);
  });

  // Observed: removing the last key empties the mapping rather than deleting the
  // section, so `explorers: {}` stays behind. No requirement covers the residue.
  test('explorer remove leaves an empty explorers mapping behind', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/c.yaml', 'chains: {}\n');
    await workspace.run(['explorer', 'set', 'blockscout', 'k', '--no-verify', '-p', 'c']);

    const result = await workspace.run(['explorer', 'remove', 'blockscout', '-p', 'c']);

    assert.equal(result.code, 0);
    assert.equal(await workspace.read('config/profiles/c.yaml'), 'explorers: {}\nchains: {}\n');
  });

  // REQ-065
  test('explorer set reports whether the entry was new and whether it was checked', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/c.yaml', 'chains: {}\n');

    const added = await workspace.run([
      'explorer', 'set', 'etherscan', 'key1234', '--no-verify', '-p', 'c', '--json',
    ]);
    assert.deepEqual(parseJson(added.stdout), {
      profile: 'c',
      path: `${workspace.profilesDir}/c.yaml`,
      added: true,
      explorer: 'etherscan',
      verified: false,
    });

    const updated = await workspace.run([
      'explorer', 'set', 'etherscan', 'key5678', '--no-verify', '-p', 'c', '--json',
    ]);
    assert.equal(parseJson<{ added: boolean }>(updated.stdout).added, false);
  });
});

describe('write mechanics', () => {
  // REQ-035: writes go through a temporary file and a rename
  test('a successful write leaves no temporary file behind', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.run(['profile', 'create', 'work', '--empty']);

    await workspace.run(setBase('work', 'http://127.0.0.1:8545'));
    await workspace.run(['explorer', 'set', 'etherscan', 'k', '--no-verify', '-p', 'work']);
    await workspace.run(['profile', 'set-default', 'work']);

    assert.deepEqual(await workspace.list('config/profiles'), ['.default', 'work.yaml']);
  });

  // REQ-035: a failed write removes the temporary file and leaves the target as it
  // was. REQ-147: it names the profile and the directory rather than the
  // temporary file, which no longer exists by the time anyone reads the message.
  test('a write that cannot land leaves the target untouched and cleans up', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    await denyWrites(workspace.profilesDir);

    const result = await workspace.run(setBase('work', 'http://127.0.0.1:8545'));

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `Could not write ${workspace.profilesDir}/work.yaml: permission denied. Nothing written.\n` +
        `Check the directory: ls -ld ${workspace.profilesDir}\n`
    );
    assert.ok(!result.stderr.includes('.tmp'), 'the temporary file is not named');
    assert.equal(await workspace.read('config/profiles/work.yaml'), EMPTY_PROFILE);
    assert.deepEqual(await workspace.list('config/profiles'), ['work.yaml']);
  });

  // REQ-147: the same message shape for the other paths that write a profile
  test('every write path reports an unwritable directory the same way', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/work.yaml', EMPTY_PROFILE);
    await denyWrites(workspace.profilesDir);

    for (const [args, target] of [
      [['profile', 'create', 'fresh', '--empty'], 'fresh.yaml'],
      [['profile', 'clone', 'work', 'copy'], 'copy.yaml'],
      [['profile', 'set-default', 'work'], '.default'],
    ] as const) {
      const result = await workspace.run([...args]);
      assert.equal(result.code, 1, args.join(' '));
      assert.equal(
        result.stderr,
        `Could not write ${workspace.profilesDir}/${target}: permission denied. Nothing written.\n` +
          `Check the directory: ls -ld ${workspace.profilesDir}\n`,
        args.join(' ')
      );
    }

    assert.deepEqual(await workspace.list('config/profiles'), ['work.yaml']);
  });

  // REQ-036: every creation path leaves the file owner-only
  test('every file the CLI creates is mode 600', async (t) => {
    const workspace = await createWorkspace(t);

    await workspace.run(['chain', 'list']);
    await workspace.run(['profile', 'create', 'fromBundle']);
    await workspace.run(['profile', 'create', 'blank', '--empty']);
    await workspace.run(['profile', 'clone', 'blank', 'cloned']);
    await workspace.run(['profile', 'clone', 'fromBundle', 'cloned', '--force']);
    await workspace.run(setBase('blank', 'http://127.0.0.1:8545'));
    await workspace.run(['explorer', 'set', 'etherscan', 'k', '--no-verify', '-p', 'blank']);
    await workspace.run(['profile', 'set-default', 'blank']);

    for (const name of await workspace.list('config/profiles')) {
      assert.equal(await workspace.mode(join('config/profiles', name)), '600', name);
    }
  });

  // REQ-138: nothing else is persisted
  test('a long sequence of commands leaves only profiles and the pointer', async (t) => {
    const workspace = await createWorkspace(t);

    await workspace.run(['chain', 'list']);
    await workspace.run(['profile', 'create', 'work']);
    await workspace.run(['profile', 'set-default', 'work']);
    await workspace.run(setBase('work', 'http://127.0.0.1:8545'));
    await workspace.run(['explorer', 'set', 'etherscan', 'k', '--no-verify', '-p', 'work']);
    await workspace.run(['wallet', 'generate']);
    await workspace.run(['chain', 'remove', 'base', '-p', 'work']);
    await workspace.run(['profile', 'clone', 'work', 'copy']);
    await workspace.run(['profile', 'remove', 'copy']);

    assert.deepEqual(await workspace.tree('config'), [
      'profiles',
      join('profiles', '.default'),
      join('profiles', 'default.yaml'),
      join('profiles', 'work.yaml'),
    ]);
  });
});
