/**
 * Acceptance: features/help-and-version.feature
 *
 * What an operator can learn from the binary before trusting it with a key.
 * Root help carries the one thing no documentation page can — the configuration
 * directory as resolved on this machine — so that is checked against the
 * directory the run was actually given.
 */

import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT, createWorkspace, helpCommands } from '../helpers/cli.js';

/** The five groups, and every subcommand under each: 21 in all */
export const SUBCOMMANDS = [
  ['wallet', 'balance'],
  ['wallet', 'set-nonce'],
  ['wallet', 'generate'],
  ['wallet', 'address'],
  ['wallet', 'send'],
  ['contract', 'owner'],
  ['contract', 'transfer-ownership'],
  ['contract', 'proxy-info'],
  ['contract', 'proxy-upgrade'],
  ['contract', 'code'],
  ['chain', 'list'],
  ['chain', 'set'],
  ['chain', 'remove'],
  ['explorer', 'list'],
  ['explorer', 'set'],
  ['explorer', 'remove'],
  ['profile', 'list'],
  ['profile', 'create'],
  ['profile', 'clone'],
  ['profile', 'remove'],
  ['profile', 'set-default'],
] as const;

describe('--version prints the version from the installed manifest', () => {
  test('reports the published version, and nothing on standard error', async (t) => {
    const workspace = await createWorkspace(t);
    const { version } = JSON.parse(
      await readFile(join(REPO_ROOT, 'package.json'), 'utf-8')
    ) as { version: string };

    const result = await workspace.run(['--version']);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${version}\n`);
    expect(result.stderr).toBe('');
  });
});

describe('--help is available at all three levels', () => {
  test('the root describes the binary', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: evm');
  });

  for (const [group, subcommand] of SUBCOMMANDS) {
    test(`${group} and ${group} ${subcommand} each describe themselves`, async (t) => {
      const workspace = await createWorkspace(t);

      const groupHelp = await workspace.run([group, '--help']);
      expect(groupHelp.code).toBe(0);
      expect(groupHelp.stdout).toContain(`Usage: evm ${group}`);

      const subcommandHelp = await workspace.run([group, subcommand, '--help']);
      expect(subcommandHelp.code).toBe(0);
      expect(subcommandHelp.stdout).toContain(`Usage: evm ${group} ${subcommand}`);
    });
  }
});

describe('root help names the five groups', () => {
  test('the Commands block holds the five groups and the parser’s built-in', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['--help']);

    expect(helpCommands(result.stdout)).toEqual([
      'wallet',
      'contract',
      'chain',
      'explorer',
      'profile',
      'help',
    ]);
  });
});

describe('root help names the configuration this machine will use', () => {
  test('the Configuration block names the resolved profiles directory', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['--help']);

    expect(result.stdout).toContain('Configuration:');
    expect(result.stdout).toContain(`${workspace.profilesDir}/<name>.yaml`);
  });

  test('it names all four sources of the profile in use, in precedence order', async (t) => {
    const workspace = await createWorkspace(t);

    const { stdout } = await workspace.run(['--help']);

    const order = ['-p <name>', '$EVM_ELF_PROFILE', 'evm profile set-default', '"default"'];
    const positions = order.map((source) => stdout.indexOf(source));
    expect(positions.every((position) => position !== -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test('the reported path follows $EVM_ELF_CONFIG_DIR', async (t) => {
    const workspace = await createWorkspace(t);
    const elsewhere = workspace.path('scratch');

    const result = await workspace.run(['--help'], { env: { EVM_ELF_CONFIG_DIR: elsewhere } });

    expect(result.stdout).toContain(`${elsewhere}/profiles/`);
  });
});

describe('every subcommand demonstrates itself', () => {
  test('each of the 21 prints its own options and at least one example', async (t) => {
    const workspace = await createWorkspace(t);

    for (const [group, subcommand] of SUBCOMMANDS) {
      const { stdout } = await workspace.run([group, subcommand, '--help']);
      expect(stdout, `${group} ${subcommand} lists its options`).toContain('Options:');
      expect(stdout, `${group} ${subcommand} shows an example`).toContain('Examples:');
      expect(stdout, `${group} ${subcommand} shows a pasteable example`).toContain('$ evm ');
    }
  });

  test('a worked example is a command a reader could paste', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['chain', 'set', '--help']);

    expect(result.stdout).toContain('evm chain set base https://mainnet.base.org');
  });
});

describe('help and version read no profile and write nothing', () => {
  test('asking for help does not seed a configuration directory', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['--help']);

    expect(result.code).toBe(0);
    expect(await workspace.tree('config')).toEqual([]);
  });

  test('asking for the version does not seed a configuration directory', async (t) => {
    const workspace = await createWorkspace(t);

    const result = await workspace.run(['--version']);

    expect(result.code).toBe(0);
    expect(await workspace.tree('config')).toEqual([]);
  });

  test('help succeeds even when the profile in use is broken', async (t) => {
    const workspace = await createWorkspace(t);
    await workspace.write('config/profiles/default.yaml', 'chains:\n  base:\n   : not yaml\n  }\n');

    const result = await workspace.run(['--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Configuration:');
  });
});
