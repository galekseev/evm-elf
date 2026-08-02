/**
 * Characterization: the public surface of the `evm` binary.
 *
 * Every assertion here records what the built CLI does today, not what it ought
 * to do. Where the observed behaviour contradicts the approved requirements
 * specification (docs/reverse-engineer/requirements-specification.md), the
 * observed behaviour is still what gets pinned and the test is tagged
 * `[MISMATCH REQ-NNN]` with the conflict spelled out above it.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'vitest';
import {
  REPO_ROOT,
  createWorkspace,
  hasAnsi,
  helpCommands,
  parseJson,
  stripAnsi,
} from '../helpers/cli.js';

const GROUPS = ['wallet', 'contract', 'chain', 'explorer', 'profile'] as const;

const SUBCOMMANDS: Record<(typeof GROUPS)[number], string[]> = {
  wallet: ['balance', 'set-nonce', 'generate', 'address', 'send'],
  contract: ['owner', 'transfer-ownership', 'proxy-info', 'proxy-upgrade', 'code'],
  chain: ['list', 'set', 'remove'],
  explorer: ['list', 'set', 'remove'],
  profile: ['list', 'create', 'clone', 'remove', 'set-default'],
};

describe('version', () => {
  // REQ-002
  test('--version prints the version from the package manifest and exits 0', async (t) => {
    const workspace = await createWorkspace(t);
    const manifest = JSON.parse(
      await readFile(join(REPO_ROOT, 'package.json'), 'utf-8')
    ) as { version: string };

    const result = await workspace.run(['--version']);

    assert.equal(result.code, 0);
    assert.equal(result.stdout, `${manifest.version}\n`);
    assert.equal(result.stderr, '');
  });

  test('-V is the short form', async (t) => {
    const workspace = await createWorkspace(t);
    const long = await workspace.run(['--version']);
    const short = await workspace.run(['-V']);
    assert.deepEqual(short.stdout, long.stdout);
    assert.equal(short.code, 0);
  });

  test('--version touches no file and creates no configuration', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.run(['--version']);
    assert.deepEqual(await workspace.tree('config'), []);
  });
});

describe('root help', () => {
  // REQ-001 records "exactly five command groups". Its acceptance criterion used
  // to say `evm --help` lists them "and no others", which commander's own
  // `help [command]` entry contradicted; the criterion was amended on 2026-08-01
  // to allow the parser's built-in, so this is intended behaviour.
  test('the Commands block lists the five groups plus commander help', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['--help']);

    assert.deepEqual(helpCommands(result.stdout), [...GROUPS, 'help']);
    assert.equal(result.code, 0);
  });

  // REQ-003
  test('root help prints the resolved profiles directory and the selection precedence', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['--help']);

    assert.match(result.stdout, /^Configuration:$/m);
    assert.ok(
      result.stdout.includes(`Profiles              ${workspace.profilesDir}/<name>.yaml`),
      result.stdout
    );
    assert.ok(
      result.stdout.includes(
        'Profile in use        -p <name>, else $EVM_ELF_PROFILE, else the one set by'
      )
    );
    assert.ok(result.stdout.includes('evm profile set-default, else "default"'));
  });

  test('help goes to stdout and nothing to stderr when it was asked for', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['--help']);
    assert.equal(result.stderr, '');
    assert.notEqual(result.stdout, '');
  });

  test('`evm help <group>` is the same as `evm <group> --help`', async (t) => {
    const workspace = await createWorkspace(t);
    const viaHelp = await workspace.run(['help', 'chain']);
    const viaFlag = await workspace.run(['chain', '--help']);
    assert.equal(viaHelp.stdout, viaFlag.stdout);
    assert.equal(viaHelp.code, 0);
  });
});

describe('command surface', () => {
  // REQ-001
  test('each group offers exactly the documented subcommands', async (t) => {
    const workspace = await createWorkspace(t);

    for (const group of GROUPS) {
      const result = await workspace.run([group, '--help']);
      assert.deepEqual(
        helpCommands(result.stdout),
        [...SUBCOMMANDS[group], 'help'],
        `group ${group}`
      );
    }
  });

  // REQ-004: every subcommand declares --json. Whether each one then emits JSON
  // is characterized alongside that subcommand; here only the surface is pinned.
  test('all 21 subcommands declare --json', async (t) => {
    const workspace = await createWorkspace(t);

    for (const group of GROUPS) {
      for (const command of SUBCOMMANDS[group]) {
        const result = await workspace.run([group, command, '--help']);
        assert.ok(result.stdout.includes('--json'), `${group} ${command} has no --json`);
      }
    }
  });

  // REQ-134
  test('all 21 subcommands print an Examples block under their options', async (t) => {
    const workspace = await createWorkspace(t);

    for (const group of GROUPS) {
      for (const command of SUBCOMMANDS[group]) {
        const result = await workspace.run([group, command, '--help']);
        assert.match(result.stdout, /^Examples:$/m, `${group} ${command} has no examples`);
        assert.ok(result.stdout.startsWith(`Usage: evm ${group} ${command}`));
      }
    }
  });
});

describe('exit codes and streams', () => {
  // REQ-005
  test('no arguments exits 1 and puts the usage text on stderr', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run([]);

    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.startsWith('Usage: evm [options] [command]'));
  });

  test('an unknown group and an unknown subcommand report the same way', async (t) => {
    const workspace = await createWorkspace(t);

    const group = await workspace.run(['nope']);
    assert.equal(group.code, 1);
    assert.equal(group.stdout, '');
    assert.equal(group.stderr, "error: unknown command 'nope'\n");

    const subcommand = await workspace.run(['chain', 'nope']);
    assert.equal(subcommand.code, 1);
    assert.equal(subcommand.stderr, "error: unknown command 'nope'\n");
  });

  test('an unknown option is refused by the parser', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['chain', 'list', '--nope']);

    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, "error: unknown option '--nope'\n");
  });

  // REQ-005: 0 on success, 1 on failure, nothing else. Signal termination is
  // characterized separately in interrupted-operations.test.ts.
  test('a spread of successful and failing invocations only ever exits 0 or 1', async (t) => {
    const workspace = await createWorkspace(t);
    const invocations = [
      ['--version'],
      ['--help'],
      [],
      ['nope'],
      ['chain', 'list'],
      ['chain', 'list', '-p', 'neverexisted'],
      ['chain', 'remove', 'nosuch'],
      ['profile', 'list'],
      ['profile', 'create', 'bad name!'],
      ['explorer', 'list'],
      ['explorer', 'remove', 'etherscan'],
      ['wallet', 'address', 'notakey'],
      ['wallet', 'generate', '--words', '13'],
    ];

    for (const args of invocations) {
      const result = await workspace.run(args);
      assert.ok([0, 1].includes(result.code ?? -1), `evm ${args.join(' ')} exited ${result.code}`);
      assert.equal(result.signal, null);
    }
  });

  // REQ-006: the first-run notice is a diagnostic, so --json output stays parseable
  // when stderr is discarded.
  test('the seeding notice goes to stderr while --json keeps stdout parseable', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['chain', 'list', '--json']);

    assert.equal(result.code, 0);
    assert.match(result.stderr, /^Created .*default\.yaml from the bundled default profile\n$/);
    const parsed = parseJson<{ profile: string }>(result.stdout);
    assert.equal(parsed.profile, 'default');
  });

  // REQ-009
  test('a failure prints one line to stderr with no stack frames', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['chain', 'list', '-p', 'neverexisted']);

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `Profile not found: ${workspace.profilesDir}/neverexisted.yaml\n`
    );
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  });
});

describe('colour', () => {
  test('output is plain when standard output is a pipe', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['chain', 'list']);
    assert.equal(hasAnsi(result.stdout), false);
  });

  test('FORCE_COLOR reinstates ANSI styling, and changes nothing else', async (t) => {
    const workspace = await createWorkspace(t);
    const plain = await workspace.run(['chain', 'list']);
    const coloured = await workspace.run(['chain', 'list'], { env: { FORCE_COLOR: '1' } });

    assert.equal(hasAnsi(coloured.stdout), true);
    assert.equal(stripAnsi(coloured.stdout), plain.stdout);
  });

  test('NO_COLOR keeps it plain', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['chain', 'list'], { env: { NO_COLOR: '1' } });
    assert.equal(hasAnsi(result.stdout), false);
  });
});
