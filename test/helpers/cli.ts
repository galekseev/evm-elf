/**
 * Harness for the characterization suite: runs the built CLI as a child process
 * inside a throwaway directory tree.
 *
 * Two things every test depends on. The environment is built from nothing rather
 * than inherited, so the machine's own $HOME, $XDG_CONFIG_HOME, .env files and
 * profiles cannot reach the run. And the workspace root is passed through
 * realpath, because the CLI prints paths it resolved through process.cwd(),
 * which on macOS reports /private/var where mkdtemp returned /var.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTree, type TestLifecycle, type Tree } from './tree.js';

export { denyWrites, type TestLifecycle } from './tree.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The published entry point: `bin.evm` in package.json */
export const CLI_ENTRY = join(REPO_ROOT, 'dist', 'index.js');

export const BUNDLED_PROFILE_PATH = join(REPO_ROOT, 'config', 'default-profile.yaml');

/** The 14 chains of the bundled profile, in file order */
export const BUNDLED_CHAINS = [
  'arbitrum',
  'avax',
  'base',
  'bsc',
  'xdai',
  'linea',
  'mainnet',
  'optimistic',
  'matic',
  'sepolia',
  'sonic',
  'unichain',
  'zksync',
  'robinhood',
] as const;

/**
 * Keys with no funds and no meaning, used only to exercise key handling. Three
 * of them, so a test can tell which source a value came from by the address the
 * CLI derives.
 */
export const KEYS = {
  one: {
    key: '0x0000000000000000000000000000000000000000000000000000000000000001',
    address: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
  },
  two: {
    key: '0x0000000000000000000000000000000000000000000000000000000000000002',
    address: '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF',
  },
  three: {
    key: '0x0000000000000000000000000000000000000000000000000000000000000003',
    address: '0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69',
  },
} as const;

/** A checksummed address that is not derived from any of the keys above */
export const SOME_ADDRESS = '0x0000000000000000000000000000000000000001';

export interface RunOptions {
  /**
   * Added to the constructed environment. An explicit `undefined` removes a
   * variable the harness would otherwise set.
   */
  env?: Record<string, string | undefined>;
  /** Defaults to the workspace's `cwd` directory */
  cwd?: string;
  /** Written to the child's standard input, which is then closed */
  stdin?: string;
  /** Pass false to leave `EVM_ELF_CONFIG_DIR` unset */
  setConfigDir?: boolean;
  /**
   * How long the run may take before the child is killed and the run reported
   * as hung. Defaults to {@link DEFAULT_TIMEOUT_MS}.
   */
  timeoutMs?: number;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /**
   * Set when writing `options.stdin` failed. The CLI reads nothing from standard
   * input and exits without draining it, so a writer of more than a pipe buffer
   * gets EPIPE — a property of the writer, recorded rather than thrown.
   */
  stdinError?: NodeJS.ErrnoException;
}

export interface RunningCli {
  child: ChildProcess;
  /** Resolves once the process has exited and both streams have closed */
  result: Promise<RunResult>;
  /**
   * Resolves once the pattern has appeared on either stream. Lets a test that
   * means to interrupt a run wait for evidence that the run has started,
   * instead of sending the signal after a guessed delay.
   */
  waitForOutput(pattern: RegExp): Promise<void>;
}

/**
 * Long enough for the CLI's own bounds — a 5s chain-id check, a 60s nonce poll —
 * and short enough to fail inside the runner's timeout, so a hung child is
 * reported as a hung child rather than as an expired test.
 */
export const DEFAULT_TIMEOUT_MS = 70_000;

export interface Workspace extends Tree {
  run(args: string[], options?: RunOptions): Promise<RunResult>;
  start(args: string[], options?: RunOptions): RunningCli;
}

export async function createWorkspace(t: TestLifecycle): Promise<Workspace> {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(`${CLI_ENTRY} is not built. Run: npm run build`);
  }

  const tree = await createTree(t, 'evm-elf-char-');
  const { cwd, configDir, home } = tree;

  const buildEnv = (options: RunOptions = {}): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: home,
    };
    if (options.setConfigDir !== false) {
      env.EVM_ELF_CONFIG_DIR = configDir;
    }
    for (const [name, value] of Object.entries(options.env ?? {})) {
      if (value === undefined) {
        delete env[name];
      } else {
        env[name] = value;
      }
    }
    return env;
  };

  const start = (args: string[], options: RunOptions = {}): RunningCli => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      cwd: options.cwd ?? cwd,
      env: buildEnv(options),
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });

    let stdinError: NodeJS.ErrnoException | undefined;
    if (options.stdin !== undefined) {
      child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
        stdinError = error;
      });
      child.stdin?.end(options.stdin);
    }

    let stdout = '';
    let stderr = '';
    const watchers: { pattern: RegExp; resolve: () => void }[] = [];
    const onOutput = (): void => {
      for (const watcher of watchers.splice(0)) {
        if (watcher.pattern.test(stdout) || watcher.pattern.test(stderr)) {
          watcher.resolve();
        } else {
          watchers.push(watcher);
        }
      }
    };
    child.stdout?.setEncoding('utf-8').on('data', (chunk: string) => {
      stdout += chunk;
      onOutput();
    });
    child.stderr?.setEncoding('utf-8').on('data', (chunk: string) => {
      stderr += chunk;
      onOutput();
    });

    // A CLI that never exits would otherwise hang until the runner's own
    // timeout, which reports the test rather than the command.
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref();

    const result = new Promise<RunResult>((resolvePromise, rejectPromise) => {
      child.on('error', rejectPromise);
      // 'close' rather than 'exit': the streams may still be flushing on exit
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (timedOut) {
          rejectPromise(
            new Error(
              `evm ${args.join(' ')} did not exit within ${timeoutMs}ms and was killed.\n` +
                `stdout: ${JSON.stringify(stdout)}\nstderr: ${JSON.stringify(stderr)}`
            )
          );
          return;
        }
        resolvePromise({ code, signal, stdout, stderr, stdinError });
      });
    });

    const waitForOutput = (pattern: RegExp): Promise<void> =>
      new Promise((resolvePromise, rejectPromise) => {
        if (pattern.test(stdout) || pattern.test(stderr)) {
          resolvePromise();
          return;
        }
        watchers.push({ pattern, resolve: resolvePromise });
        child.on('close', () => {
          rejectPromise(
            new Error(
              `evm ${args.join(' ')} exited before printing ${pattern}.\n` +
                `stdout: ${JSON.stringify(stdout)}\nstderr: ${JSON.stringify(stderr)}`
            )
          );
        });
      });

    return { child, result, waitForOutput };
  };

  return { ...tree, start, run: (args, options) => start(args, options).result };
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*m/;

/** Strip ANSI colour, for the runs that ask for it with FORCE_COLOR */
export function stripAnsi(value: string): string {
  return value.replace(new RegExp(ANSI, 'g'), '');
}

export function hasAnsi(value: string): boolean {
  return ANSI.test(value);
}

/** Non-empty output lines, trimmed of trailing spaces the column padding leaves */
export function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line !== '');
}

/**
 * The row of a padded table whose first column is `name`, ignoring the `*`
 * marker column that `evm profile list` puts in front of it.
 */
export function row(output: string, name: string): string | undefined {
  return lines(output).find((line) => {
    const cells = line.replace(/^\s*\*?\s*/, '');
    return cells === name || cells.startsWith(`${name} `);
  });
}

/**
 * Names listed under `Commands:` in a help screen. Commander wraps a long
 * description onto deeply indented continuation lines, so only the entries at
 * exactly two spaces of indent count.
 */
export function helpCommands(output: string): string[] {
  const all = output.split('\n');
  const start = all.indexOf('Commands:');
  if (start === -1) {
    return [];
  }
  const names: string[] = [];
  for (const line of all.slice(start + 1)) {
    if (line.trim() === '') {
      break;
    }
    const match = /^ {2}(\S+)/.exec(line);
    if (match) {
      names.push(match[1]);
    }
  }
  return names;
}

export function parseJson<T = unknown>(output: string): T {
  return JSON.parse(output) as T;
}

/** A minimal profile file, written as the operator would write one */
export function profileYaml(
  chains: Record<string, Record<string, unknown>>,
  extra = ''
): string {
  const body = Object.entries(chains)
    .map(([name, fields]) => {
      const lines_ = Object.entries(fields).map(([key, value]) => `    ${key}: ${String(value)}`);
      return [`  ${name}:`, ...lines_].join('\n');
    })
    .join('\n');
  return `chains:\n${body}\n${extra}`;
}
