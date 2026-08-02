/**
 * The throwaway directory tree every layer runs against.
 *
 * Both harnesses need the same three places — a working directory, a
 * configuration directory, and a home — and the same handful of questions about
 * what ended up in them. The child-process harness in cli.ts adds a spawn to
 * this; the in-process harness in inprocess.ts adds a call.
 *
 * The root is passed through realpath because the CLI prints paths it resolved
 * through process.cwd(), which on macOS reports /private/var where mkdtemp
 * returned /var.
 */

import { realpathSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The slice of a test context the harnesses need: somewhere to hang cleanup
 * off. Stated structurally rather than imported, so nothing here names a
 * runner.
 */
export interface TestLifecycle {
  onTestFinished(cleanup: () => void | Promise<void>): void;
}

export interface Tree {
  /** Throwaway root; everything below it is removed when the test ends */
  readonly root: string;
  /** Directory the CLI runs in, and where `./.env` is looked for */
  readonly cwd: string;
  /** Reached as `$EVM_ELF_CONFIG_DIR` */
  readonly configDir: string;
  readonly profilesDir: string;
  readonly home: string;

  path(...segments: string[]): string;
  write(relativePath: string, contents: string): Promise<void>;
  read(relativePath: string): Promise<string>;
  exists(relativePath: string): Promise<boolean>;
  /** Permission bits as an octal string, e.g. `600` */
  mode(relativePath: string): Promise<string>;
  /** Every path under the workspace root, relative and sorted */
  tree(relativePath?: string): Promise<string[]>;
  /** Names directly inside a directory, sorted, including dotfiles */
  list(relativePath: string): Promise<string[]>;
}

export async function createTree(t: TestLifecycle, prefix: string): Promise<Tree> {
  const root = realpathSync(await mkdtemp(join(tmpdir(), prefix)));
  const cwd = join(root, 'cwd');
  const configDir = join(root, 'config');
  const profilesDir = join(configDir, 'profiles');
  const home = join(root, 'home');
  await Promise.all([mkdir(cwd), mkdir(configDir), mkdir(home)]);

  t.onTestFinished(async () => {
    // A test may have taken write permission off a directory to characterize a
    // failed write; give it back before removing the tree.
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  });

  const path = (...segments: string[]): string => join(root, ...segments);

  return {
    root,
    cwd,
    configDir,
    profilesDir,
    home,
    path,
    async write(relativePath, contents) {
      const target = path(relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
    },
    read: (relativePath) => readFile(path(relativePath), 'utf-8'),
    async exists(relativePath) {
      try {
        await stat(path(relativePath));
        return true;
      } catch {
        return false;
      }
    },
    async mode(relativePath) {
      const stats = await stat(path(relativePath));
      return (stats.mode & 0o777).toString(8).padStart(3, '0');
    },
    async tree(relativePath = '') {
      const base = path(relativePath);
      const found: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          found.push(full.slice(base.length + 1));
          if (entry.isDirectory()) {
            await walk(full);
          }
        }
      };
      await walk(base);
      return found.sort();
    },
    async list(relativePath) {
      return (await readdir(path(relativePath))).sort();
    },
  };
}

async function makeWritable(dir: string): Promise<void> {
  await chmod(dir, 0o700).catch(() => undefined);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await makeWritable(join(dir, entry.name));
    }
  }
}

/** Take write permission off a directory or file for the rest of the test */
export async function denyWrites(target: string): Promise<void> {
  await chmod(target, 0o500);
}
