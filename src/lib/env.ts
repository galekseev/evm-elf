/**
 * Configuration discovery and environment loading.
 *
 * Nothing here assumes a checkout: the default profile ships inside the package
 * and the profiles the CLI actually reads live under the XDG config directory,
 * so it behaves the same whether it runs from source or from a global install.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BUNDLED_PROFILE_RELATIVE = 'config/default-profile.yaml';

/**
 * Walk up to the package root, identified by the bundled profile. A fixed
 * relative path doesn't work: this file sits at src/lib/ when run from source
 * (tsx) but at dist/src/lib/ once compiled.
 */
function findPackageRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(resolve(dir, BUNDLED_PROFILE_RELATIVE))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate bundled ${BUNDLED_PROFILE_RELATIVE} above ${start}`);
    }
    dir = parent;
  }
}

export const PACKAGE_ROOT = findPackageRoot(__dirname);
export const BUNDLED_DEFAULT_PROFILE_PATH = resolve(PACKAGE_ROOT, BUNDLED_PROFILE_RELATIVE);

const CONFIG_HOME = process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config');

/** Overridable so that tests and throwaway setups don't touch the real config */
export const USER_CONFIG_DIR = process.env.EVM_ELF_CONFIG_DIR
  ? resolve(process.env.EVM_ELF_CONFIG_DIR)
  : resolve(CONFIG_HOME, 'evm-elf');

export const PROFILES_DIR = resolve(USER_CONFIG_DIR, 'profiles');

/** Holds the name picked by `evm profile set-default` */
export const DEFAULT_POINTER_PATH = resolve(PROFILES_DIR, '.default');

/** Profile used when nothing else picks one; seeded from the bundled one on first use. */
export const DEFAULT_PROFILE_NAME = 'default';

export interface DefaultProfile {
  name: string;
  source: 'env' | 'pointer' | 'builtin';
}

/**
 * The profile to use when -p is not given: $EVM_ELF_PROFILE wins over the
 * pointer written by `evm profile set-default`, which wins over the built-in
 * name. Reading the pointer is best-effort, so an unreadable one is ignored
 * rather than breaking every command.
 */
export function resolveDefaultProfile(): DefaultProfile {
  if (process.env.EVM_ELF_PROFILE) {
    return { name: process.env.EVM_ELF_PROFILE, source: 'env' };
  }
  try {
    const pointed = readFileSync(DEFAULT_POINTER_PATH, 'utf-8').trim();
    if (pointed) {
      return { name: pointed, source: 'pointer' };
    }
  } catch {
    // no pointer yet
  }
  return { name: DEFAULT_PROFILE_NAME, source: 'builtin' };
}

export function defaultProfileName(): string {
  return resolveDefaultProfile().name;
}

let envLoaded = false;

/**
 * Load .env from the current directory, then from the user config directory.
 * dotenv never overwrites an already-set variable, so the precedence is
 * real environment > project .env > user .env.
 */
export function loadEnv(): void {
  if (envLoaded) {
    return;
  }
  envLoaded = true;
  dotenvConfig({ path: resolve(process.cwd(), '.env') });
  dotenvConfig({ path: resolve(USER_CONFIG_DIR, '.env') });
}

/** Resolve ${VAR_NAME} references in a config value from the environment. */
export function resolveEnvRefs(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(`Environment variable ${varName} not set`);
    }
    return envValue;
  });
}

/**
 * Same, but an unset variable yields undefined instead of throwing. Used for
 * values a command can do without, such as an explorer API key: a missing one
 * drops that source rather than failing the whole run.
 */
export function tryResolveEnvRefs(value: string): string | undefined {
  try {
    const resolved = resolveEnvRefs(value);
    return resolved === '' ? undefined : resolved;
  } catch {
    return undefined;
  }
}
