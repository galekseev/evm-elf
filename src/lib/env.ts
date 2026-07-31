/**
 * Configuration discovery and environment loading.
 *
 * Nothing here assumes a checkout: the chain list ships inside the package and
 * user overrides live under the XDG config directory, so the CLI behaves the
 * same whether it runs from source or from a global install.
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BUNDLED_CHAINS_RELATIVE = 'config/chains.yaml';

/**
 * Walk up to the package root, identified by the bundled chain list. A fixed
 * relative path doesn't work: this file sits at src/lib/ when run from source
 * (tsx) but at dist/src/lib/ once compiled.
 */
function findPackageRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(resolve(dir, BUNDLED_CHAINS_RELATIVE))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate bundled ${BUNDLED_CHAINS_RELATIVE} above ${start}`);
    }
    dir = parent;
  }
}

export const PACKAGE_ROOT = findPackageRoot(__dirname);
export const BUNDLED_CHAINS_PATH = resolve(PACKAGE_ROOT, BUNDLED_CHAINS_RELATIVE);

const CONFIG_HOME = process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config');

/** Overridable so that tests and throwaway setups don't touch the real config */
export const USER_CONFIG_DIR = process.env.EVM_ELF_CONFIG_DIR
  ? resolve(process.env.EVM_ELF_CONFIG_DIR)
  : resolve(CONFIG_HOME, 'evm-elf');

export const USER_CHAINS_PATH = resolve(USER_CONFIG_DIR, 'chains.yaml');
export const PROFILES_DIR = resolve(USER_CONFIG_DIR, 'profiles');

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
