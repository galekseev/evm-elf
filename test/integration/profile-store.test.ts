/**
 * Integration: the profiles directory as a store — what is created on first
 * use, what the three sources of a profile name agree on, and what a write
 * leaves behind.
 *
 * Nothing here touches a network. The boundary being crossed is the filesystem,
 * and it is the real one, because the properties worth checking — a mode of
 * 600, a pointer file cleared alongside the profile it named, a copy that does
 * not inherit the bundled file's permissions — are properties of real files.
 */

import { describe, expect, test } from 'vitest';
import { createRunner } from '../helpers/inprocess.js';

interface ProfileList {
  default: string;
  source: 'env' | 'pointer' | 'builtin';
  profiles: { name: string; path: string; chains?: number; default: boolean; error?: string }[];
}

describe('the first run', () => {
  test('seeds the default profile from the bundled one', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['chain', 'list', '--json']);

    expect(result.code).toBe(0);
    expect(await runner.exists('config/profiles/default.yaml')).toBe(true);
    expect(Object.keys(JSON.parse(result.stdout).chains).length).toBeGreaterThan(0);
  });

  test('says what it created on standard error, leaving stdout parseable', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['chain', 'list', '--json']);

    expect(result.stderr).toContain('from the bundled default profile');
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  test('leaves the seeded profile readable only by its owner', async (t) => {
    const runner = await createRunner(t);

    await runner.invoke(['chain', 'list', '--json']);

    expect(await runner.mode('config/profiles/default.yaml')).toBe('600');
  });

  test('does not seed a profile under any other name', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['chain', 'list'], { env: { EVM_ELF_PROFILE: 'work' } });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Profile not found');
    expect(await runner.exists('config/profiles/work.yaml')).toBe(false);
  });

  test('a second run neither recreates nor overwrites what the first one seeded', async (t) => {
    const runner = await createRunner(t);
    await runner.invoke(['chain', 'list', '--json']);
    await runner.write('config/profiles/default.yaml', 'chains:\n  only-mine:\n    chain_id: 1\n');

    const result = await runner.invoke(['chain', 'list', '--json']);

    expect(result.stderr).toBe('');
    expect(Object.keys(JSON.parse(result.stdout).chains)).toEqual(['only-mine']);
  });
});

describe('which profile is in use', () => {
  test('$EVM_ELF_PROFILE outranks the pointer file', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/from-env.yaml', 'chains: {}\n');
    await runner.write('config/profiles/from-pointer.yaml', 'chains: {}\n');
    await runner.write('config/profiles/.default', 'from-pointer\n');

    const result = await runner.invoke(['profile', 'list', '--json'], {
      env: { EVM_ELF_PROFILE: 'from-env' },
    });

    const listed = JSON.parse(result.stdout) as ProfileList;
    expect(listed.default).toBe('from-env');
    expect(listed.source).toBe('env');
  });

  test('the pointer file outranks the built-in name', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/from-pointer.yaml', 'chains: {}\n');
    await runner.write('config/profiles/.default', 'from-pointer\n');

    const listed = JSON.parse((await runner.invoke(['profile', 'list', '--json'])).stdout) as ProfileList;

    expect(listed).toMatchObject({ default: 'from-pointer', source: 'pointer' });
  });

  test('with neither, the built-in name is used and says so', async (t) => {
    const runner = await createRunner(t);

    const listed = JSON.parse((await runner.invoke(['profile', 'list', '--json'])).stdout) as ProfileList;

    expect(listed).toMatchObject({ default: 'default', source: 'builtin' });
  });

  test('-p outranks all three', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/.default', 'from-pointer\n');
    await runner.write('config/profiles/explicit.yaml', 'chains:\n  only-here:\n    chain_id: 7\n');

    const result = await runner.invoke(['chain', 'list', '--json', '-p', 'explicit'], {
      env: { EVM_ELF_PROFILE: 'from-env' },
    });

    expect(JSON.parse(result.stdout).profile).toBe('explicit');
  });

  test('the alternative extension is found when it is the only one', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yml', 'chains:\n  base:\n    chain_id: 8453\n');

    const result = await runner.invoke(['chain', 'list', '--json', '-p', 'work']);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).path).toBe(runner.path('config', 'profiles', 'work.yml'));
  });

  test('with both extensions present, .yaml wins', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains:\n  from-yaml:\n    chain_id: 1\n');
    await runner.write('config/profiles/work.yml', 'chains:\n  from-yml:\n    chain_id: 2\n');

    const result = await runner.invoke(['chain', 'list', '--json', '-p', 'work']);

    expect(Object.keys(JSON.parse(result.stdout).chains)).toEqual(['from-yaml']);
  });
});

describe('profile create', () => {
  test('copies the bundled chain list', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['profile', 'create', 'work', '--json']);

    expect(result.code).toBe(0);
    expect(await runner.mode('config/profiles/work.yaml')).toBe('600');
    expect(await runner.read('config/profiles/work.yaml')).toContain('chains:');
  });

  test('--empty writes a profile with no chains and a note on how to fill it', async (t) => {
    const runner = await createRunner(t);

    await runner.invoke(['profile', 'create', 'work', '--empty']);

    const written = await runner.read('config/profiles/work.yaml');
    expect(written).toContain('chains: {}');
    expect(written).toContain('evm chain set');
  });

  test('refuses to create over an existing profile, leaving it untouched', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains:\n  mine:\n    chain_id: 1\n');

    const result = await runner.invoke(['profile', 'create', 'work']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Profile already exists');
    expect(await runner.read('config/profiles/work.yaml')).toContain('mine');
  });

  test('refuses a name that would leave the profiles directory', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['profile', 'create', '../escaped']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Invalid profile name');
  });
});

describe('profile clone', () => {
  test('copies a profile byte for byte, comments included', async (t) => {
    const runner = await createRunner(t);
    const source = '# a header\n\nchains:\n  # a comment\n  base:\n    chain_id: 8453\n';
    await runner.write('config/profiles/work.yaml', source);

    const result = await runner.invoke(['profile', 'clone', 'work', 'copy']);

    expect(result.code).toBe(0);
    expect(await runner.read('config/profiles/copy.yaml')).toBe(source);
  });

  test('takes a path as the source, so a profile in a repository is usable', async (t) => {
    const runner = await createRunner(t);
    await runner.write('cwd/team-chains.yaml', 'chains:\n  base:\n    chain_id: 8453\n');

    const result = await runner.invoke(['profile', 'clone', './team-chains.yaml', 'team']);

    expect(result.code).toBe(0);
    expect(await runner.read('config/profiles/team.yaml')).toContain('8453');
  });

  test('tightens the permissions of a laxer source', async (t) => {
    const runner = await createRunner(t);
    await runner.write('cwd/team-chains.yaml', 'chains: {}\n');

    await runner.invoke(['profile', 'clone', './team-chains.yaml', 'team']);

    expect(await runner.mode('config/profiles/team.yaml')).toBe('600');
  });

  test('refuses an existing target and names the way past it', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains: {}\n');
    await runner.write('config/profiles/copy.yaml', 'chains:\n  keep-me:\n    chain_id: 1\n');

    const result = await runner.invoke(['profile', 'clone', 'work', 'copy']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--force');
    expect(await runner.read('config/profiles/copy.yaml')).toContain('keep-me');
  });

  test('--force makes it repeatable, with the same result each time', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains:\n  base:\n    chain_id: 8453\n');
    await runner.write('config/profiles/copy.yaml', 'chains: {}\n');

    await runner.invoke(['profile', 'clone', 'work', 'copy', '--force']);
    const once = await runner.read('config/profiles/copy.yaml');
    await runner.invoke(['profile', 'clone', 'work', 'copy', '--force']);

    expect(await runner.read('config/profiles/copy.yaml')).toBe(once);
  });

  test('refuses a clone onto itself before anything is opened for writing', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains:\n  base:\n    chain_id: 8453\n');

    const result = await runner.invoke(['profile', 'clone', 'work', 'work', '--force']);

    expect(result.code).toBe(1);
    expect(await runner.read('config/profiles/work.yaml')).toContain('8453');
  });

  test('--json names the source and the target', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains: {}\n');

    const result = await runner.invoke(['profile', 'clone', 'work', 'copy', '--json']);

    expect(JSON.parse(result.stdout)).toEqual({
      profile: 'copy',
      path: runner.path('config', 'profiles', 'copy.yaml'),
      source: runner.path('config', 'profiles', 'work.yaml'),
      chains: [],
    });
  });

  test('refuses a source that is not there', async (t) => {
    const runner = await createRunner(t);

    const result = await runner.invoke(['profile', 'clone', 'nowhere', 'copy']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Profile not found');
    expect(await runner.exists('config/profiles/copy.yaml')).toBe(false);
  });
});

describe('profile remove and set-default', () => {
  test('set-default writes the pointer and reports what it was', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains: {}\n');

    const result = await runner.invoke(['profile', 'set-default', 'work', '--json']);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ default: 'work', previous: 'default' });
    expect(await runner.read('config/profiles/.default')).toBe('work\n');
  });

  test('set-default refuses a profile that does not exist, and lists what does', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains: {}\n');

    const result = await runner.invoke(['profile', 'set-default', 'nowhere']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('available: work');
    expect(await runner.exists('config/profiles/.default')).toBe(false);
  });

  test('set-default warns that a variable still overrides the pointer it wrote', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains: {}\n');
    await runner.write('config/profiles/other.yaml', 'chains: {}\n');

    const result = await runner.invoke(['profile', 'set-default', 'work'], {
      env: { EVM_ELF_PROFILE: 'other' },
    });

    expect(result.stdout).toContain('$EVM_ELF_PROFILE');
    expect(await runner.read('config/profiles/.default')).toBe('work\n');
  });

  test('removing the profile in use is refused without --force', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains: {}\n');
    await runner.write('config/profiles/.default', 'work\n');

    const result = await runner.invoke(['profile', 'remove', 'work']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--force');
    expect(await runner.exists('config/profiles/work.yaml')).toBe(true);
  });

  test('--force removes it and clears the pointer that named it', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains: {}\n');
    await runner.write('config/profiles/.default', 'work\n');

    const result = await runner.invoke(['profile', 'remove', 'work', '--force', '--json']);

    expect(JSON.parse(result.stdout)).toMatchObject({ removed: 'work', defaultCleared: true });
    expect(await runner.exists('config/profiles/work.yaml')).toBe(false);
    expect(await runner.exists('config/profiles/.default')).toBe(false);
  });

  test('a profile not in use is removed without asking', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains: {}\n');

    const result = await runner.invoke(['profile', 'remove', 'work']);

    expect(result.code).toBe(0);
    expect(await runner.exists('config/profiles/work.yaml')).toBe(false);
  });

  test('removing the same profile twice fails the second time and lists what is left', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains: {}\n');
    await runner.write('config/profiles/other.yaml', 'chains: {}\n');

    await runner.invoke(['profile', 'remove', 'work']);
    const second = await runner.invoke(['profile', 'remove', 'work']);

    expect(second.code).toBe(1);
    expect(second.stderr).toContain('available: other');
  });
});

describe('profile list', () => {
  test('counts the chains in each profile and marks the one in use', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains:\n  base:\n    chain_id: 8453\n');
    await runner.write('config/profiles/.default', 'work\n');

    const listed = JSON.parse((await runner.invoke(['profile', 'list', '--json'])).stdout) as ProfileList;

    expect(listed.profiles).toEqual([
      {
        name: 'work',
        path: runner.path('config', 'profiles', 'work.yaml'),
        chains: 1,
        default: true,
      },
    ]);
  });

  test('one broken profile does not hide the readable ones', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/broken.yaml', 'chains:\n  base:\n    chain_id: not-a-number\n');
    await runner.write('config/profiles/work.yaml', 'chains:\n  base:\n    chain_id: 8453\n');
    await runner.write('config/profiles/.default', 'work\n');

    const listed = JSON.parse((await runner.invoke(['profile', 'list', '--json'])).stdout) as ProfileList;

    const byName = new Map(listed.profiles.map((profile) => [profile.name, profile]));
    expect(byName.get('broken')?.error).toContain('non-numeric chain_id');
    expect(byName.get('work')?.chains).toBe(1);
  });

  test('listing seeds the default profile, so a fresh machine shows something', async (t) => {
    const runner = await createRunner(t);

    const listed = JSON.parse((await runner.invoke(['profile', 'list', '--json'])).stdout) as ProfileList;

    expect(listed.profiles.map((profile) => profile.name)).toEqual(['default']);
    expect(await runner.exists('config/profiles/default.yaml')).toBe(true);
  });

  test('the legend is a result and the missing-default warning is a diagnostic', async (t) => {
    const runner = await createRunner(t);
    await runner.write('config/profiles/work.yaml', 'chains: {}\n');
    await runner.write('config/profiles/.default', 'work\n');

    const present = await runner.invoke(['profile', 'list']);
    expect(present.stdout).toContain('* in use: work');
    expect(present.stderr).toBe('');

    await runner.write('config/profiles/.default', 'gone\n');
    const missing = await runner.invoke(['profile', 'list']);
    expect(missing.stderr).toContain("Default profile 'gone' is missing");
  });
});
