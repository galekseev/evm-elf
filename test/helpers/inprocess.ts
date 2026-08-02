/**
 * Harness for the integration layer: the CLI's own Commander tree, run inside
 * the test process against a real temp filesystem and real loopback servers.
 *
 * Why in process, when the acceptance layer already runs the binary: a child
 * process is opaque. Here a test can reach a module directly, drive one command
 * group without the rest of the program, and — the reason the layer exists at
 * all — the code is instrumented, so the coverage gate measures something.
 *
 * Three things a command does that an ordinary function call would not survive
 * are taken over for the duration of the call:
 *
 *   process.exit    becomes a thrown ExitSignal, carrying the code
 *   the two streams are captured, so stdout and stderr stay separable
 *   the module registry is reset, because src/lib/env.ts reads
 *                   $EVM_ELF_CONFIG_DIR once, at import
 *
 * The last of those is why every import of the code under test happens inside
 * the callback rather than at the top of the test file.
 */

import { format } from 'node:util';
import type { Command } from 'commander';
import { vi } from 'vitest';
import { createTree, type TestLifecycle, type Tree } from './tree.js';

/** Variables that steer the CLI, cleared so the developer's shell cannot reach a run */
const CLI_ENV = [
  'EVM_ELF_CONFIG_DIR',
  'EVM_ELF_PROFILE',
  'XDG_CONFIG_HOME',
  'EVM_PRICE_SOURCE',
  'COINGECKO_API_KEY',
  'FORCE_COLOR',
];

/** Thrown in place of process.exit, so a command that exits unwinds rather than taking the worker with it */
export class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
    this.name = 'ExitSignal';
  }
}

export interface Outcome {
  stdout: string;
  stderr: string;
  /** 0 when the call returned, otherwise what it exited or failed with */
  code: number;
}

export interface CaptureOptions {
  /** Added to the workspace environment; an explicit undefined removes one */
  env?: Record<string, string | undefined>;
  /** Defaults to the workspace's `cwd` */
  cwd?: string;
}

export interface Runner extends Tree {
  /**
   * Run one command group the way the binary wires it, e.g.
   * `invoke(['chain', 'list', '--json'])`.
   */
  invoke(args: string[], options?: CaptureOptions): Promise<Outcome>;

  /**
   * Run a callback under the workspace's environment with a fresh module
   * registry, capturing what it prints. Import the code under test inside the
   * callback.
   */
  capture<T>(fn: () => Promise<T>, options?: CaptureOptions): Promise<Outcome & { value?: T }>;
}

async function loadGroup(name: string): Promise<Command> {
  switch (name) {
    case 'wallet':
      return (await import('../../src/cli/wallet.js')).buildWalletCommand();
    case 'contract':
      return (await import('../../src/cli/contract.js')).buildContractCommand();
    case 'chain':
      return (await import('../../src/cli/chain.js')).buildChainCommand();
    case 'explorer':
      return (await import('../../src/cli/explorer.js')).buildExplorerCommand();
    case 'profile':
      return (await import('../../src/cli/profile.js')).buildProfileCommand();
    default:
      throw new Error(`No such command group: ${name}`);
  }
}

/**
 * Commander exits the process on a parse error, on --help and on an unknown
 * option. Over the whole tree, because a subcommand is given a copy of these
 * settings when it is created, and this runs afterwards.
 */
function neverExit(command: Command): void {
  command.exitOverride();
  for (const child of command.commands) {
    neverExit(child);
  }
}

/** A CommanderError carries the code the binary would have exited with */
function asExit(thrown: unknown): unknown {
  const error = thrown as { code?: unknown; exitCode?: unknown };
  if (typeof error.code === 'string' && error.code.startsWith('commander.')) {
    return new ExitSignal(typeof error.exitCode === 'number' ? error.exitCode : 1);
  }
  return thrown;
}

export async function createRunner(t: TestLifecycle): Promise<Runner> {
  const tree = await createTree(t, 'evm-elf-int-');

  async function capture<T>(
    fn: () => Promise<T>,
    options: CaptureOptions = {}
  ): Promise<Outcome & { value?: T }> {
    const savedEnv = { ...process.env };
    const savedCwd = process.cwd();

    for (const name of CLI_ENV) {
      delete process.env[name];
    }
    process.env.EVM_ELF_CONFIG_DIR = tree.configDir;
    process.env.HOME = tree.home;
    // chalk decides once per worker, so keep it decided the same way every time
    process.env.NO_COLOR = '1';
    for (const [name, value] of Object.entries(options.env ?? {})) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    process.chdir(options.cwd ?? tree.cwd);

    let stdout = '';
    let stderr = '';
    // Both routes to a stream: the commands print through console, Commander
    // writes its own help and parse errors straight to the stream.
    const spies = [
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        stdout += `${format(...args)}\n`;
      }),
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        stderr += `${format(...args)}\n`;
      }),
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
        stdout += String(chunk);
        return true;
      }),
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
        stderr += String(chunk);
        return true;
      }),
      vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new ExitSignal(Number(code ?? 0));
      }),
    ];

    // env.ts caches $EVM_ELF_CONFIG_DIR at import, so the code under test has to
    // be imported after the environment above is in force.
    vi.resetModules();

    try {
      const value = await fn();
      return { stdout, stderr, code: 0, value };
    } catch (thrown) {
      if (thrown instanceof ExitSignal) {
        return { stdout, stderr, code: thrown.code };
      }
      // What index.ts does with anything a handler throws
      stderr += `${thrown instanceof Error ? thrown.message : String(thrown)}\n`;
      return { stdout, stderr, code: 1 };
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
      process.chdir(savedCwd);
      for (const name of Object.keys(process.env)) {
        if (!(name in savedEnv)) {
          delete process.env[name];
        }
      }
      Object.assign(process.env, savedEnv);
    }
  }

  return {
    ...tree,
    capture,
    invoke(args, options) {
      const [group, ...rest] = args;
      return capture(async () => {
        const command = await loadGroup(group);
        neverExit(command);
        try {
          await command.parseAsync(rest, { from: 'user' });
        } catch (thrown) {
          throw asExit(thrown);
        }
      }, options);
    },
  };
}
