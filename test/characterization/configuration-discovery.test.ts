/**
 * Characterization: where the CLI looks for its configuration, which profile it
 * picks, and what it creates on a machine that has never run it.
 *
 * Observed behaviour is what gets pinned. Tests tagged `[MISMATCH REQ-NNN]`
 * record a conflict with the approved requirements specification and preserve
 * the behaviour as it is today.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'vitest';
import {
  BUNDLED_CHAINS,
  BUNDLED_PROFILE_PATH,
  createWorkspace,
  parseJson,
  profileYaml,
} from '../helpers/cli.js';

const ONE_CHAIN = profileYaml({ solo: { chain_id: 31337, rpc_url: 'http://127.0.0.1:8545' } });

describe('configuration directory resolution', () => {
  // REQ-010
  test('$EVM_ELF_CONFIG_DIR wins', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['--help'], {
      env: { XDG_CONFIG_HOME: workspace.path('xdg') },
    });
    assert.ok(result.stdout.includes(`${workspace.configDir}/profiles/<name>.yaml`));
  });

  // REQ-010
  test('$XDG_CONFIG_HOME/evm-elf comes next', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['--help'], {
      setConfigDir: false,
      env: { XDG_CONFIG_HOME: workspace.path('xdg') },
    });
    assert.ok(result.stdout.includes(`${workspace.path('xdg')}/evm-elf/profiles/<name>.yaml`));
  });

  // REQ-010
  test('~/.config/evm-elf is the fallback', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['--help'], { setConfigDir: false });
    assert.ok(result.stdout.includes(`${workspace.home}/.config/evm-elf/profiles/<name>.yaml`));
  });

  // Not stated by any requirement: the variable goes through path.resolve, so a
  // relative value is taken against the working directory rather than rejected.
  test('a relative $EVM_ELF_CONFIG_DIR resolves against the working directory', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['--help'], { env: { EVM_ELF_CONFIG_DIR: 'relcfg' } });
    assert.ok(result.stdout.includes(`${workspace.cwd}/relcfg/profiles/<name>.yaml`));
  });

  test('an empty $EVM_ELF_CONFIG_DIR is treated as unset', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['--help'], { env: { EVM_ELF_CONFIG_DIR: '' } });
    assert.ok(result.stdout.includes(`${workspace.home}/.config/evm-elf/profiles/<name>.yaml`));
  });
});

describe('first-run seeding', () => {
  // REQ-015, REQ-013, REQ-036
  test('a read on an empty configuration directory creates default.yaml', async (t) => {
    const workspace = await createWorkspace(t);
    assert.deepEqual(await workspace.tree('config'), []);

    const result = await workspace.run(['chain', 'list']);

    assert.equal(result.code, 0);
    assert.equal(
      result.stderr,
      `Created ${workspace.profilesDir}/default.yaml from the bundled default profile\n`
    );
    assert.deepEqual(await workspace.tree('config'), [
      'profiles',
      join('profiles', 'default.yaml'),
    ]);
    assert.equal(await workspace.mode('config/profiles/default.yaml'), '600');
  });

  // REQ-014, REQ-041
  test('the seeded file is a byte copy of the bundled profile', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.run(['chain', 'list']);

    assert.equal(
      await workspace.read('config/profiles/default.yaml'),
      await readFile(BUNDLED_PROFILE_PATH, 'utf-8')
    );
  });

  // REQ-015: seeding happens however the name `default` was reached
  for (const args of [
    ['chain', 'list', '-p', 'default'],
    ['chain', 'set', 'zz', 'http://127.0.0.1:1', '--chain-id', '1', '--no-verify', '-p', 'default'],
    ['explorer', 'list'],
    ['profile', 'list'],
    ['profile', 'set-default', 'default'],
  ]) {
    test(`\`evm ${args.join(' ')}\` seeds the default profile`, async (t) => {
      const workspace = await createWorkspace(t);
      const result = await workspace.run(args);

      assert.equal(result.code, 0);
      assert.ok(await workspace.exists('config/profiles/default.yaml'));
      assert.match(result.stderr, /Created .*default\.yaml from the bundled default profile/);
    });
  }

  // REQ-015: only `default` is created on demand
  test('a -p naming anything else creates nothing', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['chain', 'list', '-p', 'neverexisted']);

    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `Profile not found: ${workspace.profilesDir}/neverexisted.yaml\n`
    );
    assert.deepEqual(await workspace.tree('config'), []);
  });

  // REQ-014
  test('a chain removed from default.yaml is not restored from the bundle', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.run(['chain', 'list']);
    await workspace.run(['chain', 'remove', 'base']);

    const result = await workspace.run(['chain', 'list', '--json']);
    const parsed = parseJson<{ chains: Record<string, unknown> }>(result.stdout);
    assert.equal(Object.keys(parsed.chains).length, BUNDLED_CHAINS.length - 1);
    assert.ok(!('base' in parsed.chains));
  });
});

describe('profile selection precedence', () => {
  // REQ-022
  test('-p beats $EVM_ELF_PROFILE beats the pointer beats the built-in name', async (t) => {
    const workspace = await createWorkspace(t);
    for (const name of ['viaflag', 'viaenv', 'viapointer']) {
      await workspace.write(`config/profiles/${name}.yaml`, ONE_CHAIN);
    }
    await workspace.write('config/profiles/.default', 'viapointer\n');

    const named = (stdout: string): string =>
      parseJson<{ profile: string }>(stdout).profile;

    assert.equal(
      named((await workspace.run(['chain', 'list', '--json', '-p', 'viaflag'], {
        env: { EVM_ELF_PROFILE: 'viaenv' },
      })).stdout),
      'viaflag'
    );
    assert.equal(
      named((await workspace.run(['chain', 'list', '--json'], {
        env: { EVM_ELF_PROFILE: 'viaenv' },
      })).stdout),
      'viaenv'
    );
    assert.equal(named((await workspace.run(['chain', 'list', '--json'])).stdout), 'viapointer');

    await workspace.run(['profile', 'remove', 'viapointer', '--force']);
    assert.equal(named((await workspace.run(['chain', 'list', '--json'])).stdout), 'default');
  });

  test('an empty $EVM_ELF_PROFILE falls through to the next source', async (t) => {
    const workspace = await createWorkspace(t);
    const result = await workspace.run(['chain', 'list', '--json'], {
      env: { EVM_ELF_PROFILE: '' },
    });
    assert.equal(parseJson<{ profile: string }>(result.stdout).profile, 'default');
  });

  // REQ-013
  test('the pointer file holds the name with a trailing newline, owner-only', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.run(['profile', 'create', 'alpha']);
    await workspace.run(['profile', 'set-default', 'alpha']);

    assert.equal(await workspace.read('config/profiles/.default'), 'alpha\n');
    assert.equal(await workspace.mode('config/profiles/.default'), '600');
  });

  test('the pointer is trimmed, and a blank pointer falls through', async (t) => {
    const workspace = await createWorkspace(t);

    await workspace.write('config/profiles/.default', '  spaced  \n');
    const spaced = await workspace.run(['chain', 'list']);
    assert.equal(spaced.code, 1);
    assert.ok(spaced.stderr.startsWith(`Profile not found: ${workspace.profilesDir}/spaced.yaml`));

    await workspace.write('config/profiles/.default', '\n');
    const blank = await workspace.run(['chain', 'list', '--json']);
    assert.equal(parseJson<{ profile: string }>(blank.stdout).profile, 'default');
  });

  // REQ-026
  test('a missing profile names the source of the name', async (t) => {
    const workspace = await createWorkspace(t);

    const fromEnv = await workspace.run(['chain', 'list'], {
      env: { EVM_ELF_PROFILE: 'ghost' },
    });
    assert.equal(
      fromEnv.stderr,
      `Profile not found: ${workspace.profilesDir}/ghost.yaml ('ghost' comes from $EVM_ELF_PROFILE)\n`
    );

    await workspace.write('config/profiles/.default', 'ghost\n');
    const fromPointer = await workspace.run(['chain', 'list']);
    assert.equal(
      fromPointer.stderr,
      `Profile not found: ${workspace.profilesDir}/ghost.yaml ('ghost' is the default; ` +
        `change it with: evm profile set-default <name>)\n`
    );

    const fromFlag = await workspace.run(['chain', 'list', '-p', 'ghost']);
    assert.equal(fromFlag.stderr, `Profile not found: ${workspace.profilesDir}/ghost.yaml\n`);
  });

  // REQ-027, REQ-039
  test('profile list names the profile in use and how it was chosen', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/alpha.yaml', ONE_CHAIN);

    const builtin = await workspace.run(['profile', 'list']);
    assert.ok(
      builtin.stdout.includes(
        '* in use: default (built-in default; change it with evm profile set-default <name>)'
      ),
      builtin.stdout
    );

    await workspace.run(['profile', 'set-default', 'alpha']);
    const pointer = await workspace.run(['profile', 'list']);
    assert.ok(pointer.stdout.includes('* in use: alpha (set by evm profile set-default)'));

    const fromEnv = await workspace.run(['profile', 'list'], {
      env: { EVM_ELF_PROFILE: 'alpha' },
    });
    assert.ok(fromEnv.stdout.includes('* in use: alpha (from $EVM_ELF_PROFILE)'));
    assert.equal(
      parseJson<{ default: string; source: string }>(
        (await workspace.run(['profile', 'list', '--json'], { env: { EVM_ELF_PROFILE: 'alpha' } }))
          .stdout
      ).source,
      'env'
    );
  });

  // REQ-039 assumes the profile in use exists. When it does not, no row carries
  // the marker and the legend is replaced by a warning — on stderr, because the
  // legend is part of the answer and this is a diagnostic (REQ-006).
  test('profile list warns instead when the profile in use is missing', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/alpha.yaml', ONE_CHAIN);

    const result = await workspace.run(['profile', 'list'], {
      env: { EVM_ELF_PROFILE: 'ghost' },
    });

    assert.equal(result.code, 0);
    assert.ok(
      result.stderr.includes(
        `Default profile 'ghost' is missing: ${workspace.profilesDir}/ghost.yaml`
      )
    );
    assert.ok(!result.stdout.includes('is missing'), 'the table carries only the table');
    assert.ok(!result.stdout.includes('* in use:'));
  });
});

describe('profile name resolution', () => {
  // REQ-024
  test('an unusable bare name is refused on every route that validates it', async (t) => {
    const workspace = await createWorkspace(t);
    const message = "Invalid profile name 'bad name!': use letters, digits, '.', '_' or '-'\n";

    const viaFlag = await workspace.run(['chain', 'list', '-p', 'bad name!']);
    assert.equal(viaFlag.code, 1);
    assert.equal(viaFlag.stderr, message);

    const viaEnv = await workspace.run(['chain', 'list'], {
      env: { EVM_ELF_PROFILE: 'bad name!' },
    });
    assert.equal(viaEnv.stderr, message);

    await workspace.write('config/profiles/.default', 'bad name!\n');
    const viaPointer = await workspace.run(['chain', 'list']);
    assert.equal(viaPointer.stderr, message);

    const viaCreate = await workspace.run(['profile', 'create', 'bad name!']);
    assert.equal(viaCreate.stderr, message);
  });

  // REQ-024 enforces the pattern on every route, and REQ-023 grants the path form
  // to -p alone. $EVM_ELF_PROFILE and the pointer name a profile, so a slash in
  // either is an unusable name rather than a file outside the profiles directory
  // — which is what `profile set-default` has always said about the same value.
  test('a slash in $EVM_ELF_PROFILE or the pointer is an unusable name', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('outside.yaml', ONE_CHAIN);
    const outside = workspace.path('outside.yaml');

    const viaEnv = await workspace.run(['chain', 'list'], {
      env: { EVM_ELF_PROFILE: outside },
    });
    assert.equal(viaEnv.code, 1);
    assert.equal(
      viaEnv.stderr,
      `Invalid profile name '${outside}': use letters, digits, '.', '_' or '-'\n`
    );

    await workspace.write('config/profiles/.default', '../outside.yaml\n');
    const viaPointer = await workspace.run(['chain', 'list']);
    assert.equal(viaPointer.code, 1);
    assert.equal(
      viaPointer.stderr,
      "Invalid profile name '../outside.yaml': use letters, digits, '.', '_' or '-'\n"
    );

    // The same value through -p, which is the route the path form belongs to
    const viaFlag = await workspace.run(['chain', 'list', '--json', '-p', outside]);
    assert.equal(viaFlag.code, 0);
    assert.equal(parseJson<{ path: string }>(viaFlag.stdout).path, outside);
  });

  // REQ-023
  test('-p takes a relative or absolute path as a path', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/local.yaml', ONE_CHAIN);

    for (const argument of ['./local.yaml', workspace.path('cwd/local.yaml')]) {
      const result = await workspace.run(['chain', 'list', '--json', '-p', argument]);
      const parsed = parseJson<{ profile: string; path: string }>(result.stdout);
      assert.equal(parsed.profile, argument, 'the argument is echoed as the profile name');
      assert.equal(parsed.path, workspace.path('cwd/local.yaml'));
    }
  });

  test('a bare name with no slash is never treated as a path', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('cwd/local.yaml', ONE_CHAIN);

    const result = await workspace.run(['chain', 'list', '-p', 'local.yaml']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, `Profile not found: ${workspace.profilesDir}/local.yaml\n`);
  });

  // REQ-025
  test('a bare name resolves to .yaml, falling back to .yml', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/ymlonly.yml', ONE_CHAIN);
    await workspace.write('config/profiles/both.yml', profileYaml({ fromYml: { chain_id: 1 } }));
    await workspace.write('config/profiles/both.yaml', profileYaml({ fromYaml: { chain_id: 1 } }));

    const fallback = await workspace.run(['chain', 'list', '--json', '-p', 'ymlonly']);
    assert.equal(
      parseJson<{ path: string }>(fallback.stdout).path,
      `${workspace.profilesDir}/ymlonly.yml`
    );

    const both = await workspace.run(['chain', 'list', '--json', '-p', 'both']);
    assert.equal(
      parseJson<{ path: string }>(both.stdout).path,
      `${workspace.profilesDir}/both.yaml`
    );
  });

  // Not stated by any requirement: resolveProfilePath strips a .yaml or .yml
  // suffix before looking the name up, so the two spellings reach one file while
  // the displayed name keeps the suffix.
  test('a bare name may carry its own .yaml suffix', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/alpha.yaml', ONE_CHAIN);

    const result = await workspace.run(['chain', 'list', '--json', '-p', 'alpha.yaml']);
    const parsed = parseJson<{ profile: string; path: string }>(result.stdout);
    assert.equal(parsed.profile, 'alpha.yaml');
    assert.equal(parsed.path, `${workspace.profilesDir}/alpha.yaml`);
  });

  test('two profile files differing only in extension both list, under one name', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/both.yml', ONE_CHAIN);
    await workspace.write('config/profiles/both.yaml', ONE_CHAIN);

    const result = await workspace.run(['profile', 'list', '--json']);
    const parsed = parseJson<{ profiles: { name: string; path: string }[] }>(result.stdout);
    assert.deepEqual(
      parsed.profiles.map((profile) => profile.name),
      ['both', 'both', 'default']
    );
  });
});
