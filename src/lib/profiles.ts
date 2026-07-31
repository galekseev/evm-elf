/**
 * Operations on the set of profiles: listing the files, creating, cloning and
 * removing them, and the pointer that names the default one.
 *
 * Editing the chains inside one profile lives in profile-file.ts.
 */

import { constants, existsSync, readFileSync } from 'fs';
import { copyFile, mkdir, readdir, rename, unlink, writeFile } from 'fs/promises';
import { basename, dirname, extname, resolve } from 'path';
import chalk from 'chalk';
import { BUNDLED_DEFAULT_PROFILE_PATH, DEFAULT_POINTER_PATH, PROFILES_DIR } from './env.js';

const PROFILE_EXTENSIONS = ['.yaml', '.yml'];
const PROFILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const EMPTY_PROFILE = `# evm-elf profile. Add chains with: evm chain set <chain> <rpc-url>\nchains: {}\n`;

/**
 * Names in these commands become paths inside the profiles directory, so a
 * path-like argument would write to or delete a file anywhere.
 */
export function assertProfileName(name: string): void {
  if (!PROFILE_NAME.test(name)) {
    throw new Error(`Invalid profile name '${name}': use letters, digits, '.', '_' or '-'`);
  }
}

export interface ProfileFile {
  name: string;
  path: string;
}

/** Every profile file in the profiles directory, sorted by name */
export async function listProfileFiles(): Promise<ProfileFile[]> {
  let entries: string[];
  try {
    entries = await readdir(PROFILES_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => PROFILE_EXTENSIONS.includes(extname(entry)))
    .map((entry) => ({ name: basename(entry, extname(entry)), path: resolve(PROFILES_DIR, entry) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Copy the profile shipped with the package. Never overwrites, so a concurrent
 * run that got there first wins.
 */
export async function ensureDefaultProfile(targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  try {
    await copyFile(BUNDLED_DEFAULT_PROFILE_PATH, targetPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return;
    }
    throw error;
  }
  console.error(chalk.dim(`Created ${targetPath} from the bundled default profile`));
}

/**
 * Create a profile from the bundled one, or an empty one. Copying the file
 * rather than rewriting it keeps its comments.
 */
export async function createProfile(targetPath: string, empty: boolean): Promise<void> {
  if (existsSync(targetPath)) {
    throw new Error(`Profile already exists: ${targetPath}`);
  }
  await mkdir(dirname(targetPath), { recursive: true });
  if (empty) {
    await writeFile(targetPath, EMPTY_PROFILE, { mode: 0o600, flag: 'wx' });
    return;
  }
  await copyFile(BUNDLED_DEFAULT_PROFILE_PATH, targetPath, constants.COPYFILE_EXCL);
}

/** Copy a profile verbatim, so comments and key order survive */
export async function copyProfile(
  sourcePath: string,
  targetPath: string,
  force: boolean
): Promise<void> {
  if (!existsSync(sourcePath)) {
    throw new Error(`Profile not found: ${sourcePath}`);
  }
  if (resolve(sourcePath) === resolve(targetPath)) {
    throw new Error('Source and target are the same file');
  }
  if (!force && existsSync(targetPath)) {
    throw new Error(`Profile already exists: ${targetPath} (pass --force to overwrite)`);
  }
  await mkdir(dirname(targetPath), { recursive: true });
  const mode = force ? undefined : constants.COPYFILE_EXCL;
  await copyFile(sourcePath, targetPath, mode);
}

export async function deleteProfile(targetPath: string): Promise<void> {
  await unlink(targetPath);
}

/**
 * The name in the pointer file, or undefined when it is not set. Read directly
 * rather than through resolveDefaultProfile, which $EVM_ELF_PROFILE shadows.
 */
export function readDefaultPointer(): string | undefined {
  try {
    return readFileSync(DEFAULT_POINTER_PATH, 'utf-8').trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function writeDefaultPointer(name: string): Promise<void> {
  await mkdir(PROFILES_DIR, { recursive: true });
  const tmpPath = `${DEFAULT_POINTER_PATH}.${process.pid}.tmp`;
  try {
    await writeFile(tmpPath, `${name}\n`, { mode: 0o600 });
    await rename(tmpPath, DEFAULT_POINTER_PATH);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

export async function clearDefaultPointer(): Promise<void> {
  await unlink(DEFAULT_POINTER_PATH).catch(() => undefined);
}
