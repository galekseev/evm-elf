/**
 * Chain resolution: the profile *is* the chain configuration.
 * Chain selection order:
 *   -c filter > every chain the profile names
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { isAbsolute, resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import type { ChainConfig, RpcProfile } from '../types.js';
import { EXPLORER_NAMES, isExplorerName, type ExplorerSettings } from './explorer/index.js';
import {
  BUNDLED_DEFAULT_PROFILE_PATH,
  DEFAULT_PROFILE_NAME,
  PROFILES_DIR,
  defaultProfileName,
  resolveDefaultProfile,
  resolveEnvRefs,
} from './env.js';
import { ensureDefaultProfile } from './profiles.js';
import { parseRpcUrl, type RpcEndpoint } from './rpc.js';

/**
 * Resolve a profile reference: anything path-like is used as given, a bare name
 * is looked up in the profiles directory.
 */
export function resolveProfilePath(nameOrPath: string): string {
  if (nameOrPath.includes('/') || isAbsolute(nameOrPath)) {
    return resolve(process.cwd(), nameOrPath);
  }
  const baseName = nameOrPath.replace(/\.(yaml|yml)$/, '');
  const yamlPath = resolve(PROFILES_DIR, `${baseName}.yaml`);
  if (!existsSync(yamlPath)) {
    const ymlPath = resolve(PROFILES_DIR, `${baseName}.yml`);
    if (existsSync(ymlPath)) {
      return ymlPath;
    }
  }
  return yamlPath;
}

const CHAIN_FIELDS = ['chain_id', 'rpc_url', 'headers', 'symbol', 'coingecko_id', 'explorer_api'];

function parseChainEntry(filePath: string, chain: string, raw: unknown): ChainConfig {
  const where = `chain '${chain}' in ${filePath}`;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid profile: ${where} must be a mapping with chain_id and rpc_url`);
  }
  const entry = raw as Record<string, unknown>;
  const config: ChainConfig = {};

  for (const [key, value] of Object.entries(entry)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (!CHAIN_FIELDS.includes(key)) {
      throw new Error(`Invalid profile: ${where} has unknown field '${key}'`);
    }
    if (key === 'chain_id') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid profile: ${where} has a non-numeric chain_id`);
      }
      config.chain_id = value;
    } else if (key === 'headers') {
      if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Invalid profile: ${where} has a non-mapping headers`);
      }
      config.headers = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, headerValue]) => {
          if (typeof headerValue !== 'string') {
            throw new Error(`Invalid profile: ${where} has a non-string header '${name}'`);
          }
          return [name, headerValue];
        })
      );
    } else {
      if (typeof value !== 'string') {
        throw new Error(`Invalid profile: ${where} has a non-string ${key}`);
      }
      config[key as 'rpc_url' | 'symbol' | 'coingecko_id' | 'explorer_api'] = value;
    }
  }
  return config;
}

/**
 * The explorers section: one API key per known source. A typo in a source name
 * is an error rather than a silently ignored key, since the symptom would
 * otherwise be explorer fields quietly going missing.
 */
function parseExplorers(filePath: string, raw: unknown): ExplorerSettings {
  if (raw === null || raw === undefined) {
    return {};
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `Invalid profile ${filePath}: 'explorers' must be a mapping of <source>: <api key>`
    );
  }
  const settings: ExplorerSettings = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isExplorerName(name)) {
      throw new Error(
        `Invalid profile ${filePath}: unknown explorer '${name}' (known: ${EXPLORER_NAMES.join(', ')})`
      );
    }
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value !== 'string') {
      throw new Error(`Invalid profile ${filePath}: explorer '${name}' must be a string API key`);
    }
    settings[name] = value;
  }
  return settings;
}

interface ProfileContents {
  chains: Record<string, ChainConfig>;
  explorers: ExplorerSettings;
}

async function readProfileFile(filePath: string): Promise<ProfileContents> {
  const parsed = parseYaml(await readFile(filePath, 'utf-8')) as {
    chains?: unknown;
    explorers?: unknown;
  } | null;
  if (!parsed?.chains || typeof parsed.chains !== 'object' || Array.isArray(parsed.chains)) {
    throw new Error(`Invalid profile ${filePath}: expected a top-level 'chains' mapping`);
  }
  const chains: Record<string, ChainConfig> = {};
  for (const [chain, raw] of Object.entries(parsed.chains as Record<string, unknown>)) {
    chains[chain] = parseChainEntry(filePath, chain, raw);
  }
  return { chains, explorers: parseExplorers(filePath, parsed.explorers) };
}

/**
 * Name and path of the profile to work on: the one named by -p, else the
 * default one ($EVM_ELF_PROFILE, else "default"). The default profile is seeded
 * from the bundled one when it is not there yet, so reading and editing start
 * from the same file.
 */
export async function resolveProfileTarget(
  nameOrPath?: string
): Promise<{ name: string; path: string }> {
  const name = nameOrPath ?? defaultProfileName();
  const filePath = resolveProfilePath(name);
  if (!existsSync(filePath) && nameOrPath === undefined && name === DEFAULT_PROFILE_NAME) {
    await ensureDefaultProfile(filePath);
  }
  return { name, path: filePath };
}

/**
 * Where a profile nobody asked for by name came from, so that a missing one
 * points at whatever needs fixing rather than at a name out of nowhere.
 */
function missingProfileHint(nameOrPath: string | undefined): string {
  if (nameOrPath !== undefined) {
    return '';
  }
  const { name, source } = resolveDefaultProfile();
  if (source === 'pointer') {
    return ` ('${name}' is the default; change it with: evm profile set-default <name>)`;
  }
  if (source === 'env') {
    return ` ('${name}' comes from $EVM_ELF_PROFILE)`;
  }
  return '';
}

/**
 * Load the profile to read chains from. Only the default profile is created on
 * demand; any other name has to exist.
 */
export async function loadProfile(nameOrPath?: string): Promise<RpcProfile> {
  const { name, path } = await resolveProfileTarget(nameOrPath);
  if (!existsSync(path)) {
    throw new Error(`Profile not found: ${path}${missingProfileHint(nameOrPath)}`);
  }
  return { name, path, ...(await readProfileFile(path)) };
}

/**
 * Chains from the profile shipped with the package, used to fill in metadata
 * that cannot be read from an RPC. Best-effort: an unreadable template just
 * means no suggestions.
 */
export async function loadBundledChains(): Promise<Record<string, ChainConfig>> {
  try {
    return (await readProfileFile(BUNDLED_DEFAULT_PROFILE_PATH)).chains;
  } catch {
    return {};
  }
}

export interface ResolvedChain {
  chain: string;
  chainId: number;
  endpoint: RpcEndpoint | null;
  symbol?: string;
  coingeckoId?: string;
  explorerApi?: string;
  error?: string;
}

/**
 * Parse a comma-separated chain list into names
 */
export function parseChainList(value: string): string[] {
  return value.split(',').map((c) => c.trim()).filter(Boolean);
}

/**
 * Determine which chains to operate on:
 * 1. explicit -c filter (comma-separated)
 * 2. every chain the profile names
 * With -xc (excludeFilter), the profile's chains are used minus the excluded ones.
 */
export function selectChains(
  chainFilter: string | undefined,
  excludeFilter: string | undefined,
  profile: RpcProfile
): string[] {
  if (chainFilter) {
    return parseChainList(chainFilter);
  }
  const base = Object.keys(profile.chains);
  if (!excludeFilter) {
    return base;
  }
  const excluded = new Set(parseChainList(excludeFilter));
  for (const name of excluded) {
    if (!base.includes(name)) {
      console.error(`Warning: excluded chain '${name}' is not in profile '${profile.name}'`);
    }
  }
  return base.filter((c) => !excluded.has(c));
}

function resolveHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [name, resolveEnvRefs(value)])
  );
}

/**
 * Endpoint for a configured URL and headers, with ${VAR} references resolved.
 * Throws when a referenced variable is unset or the URL is malformed.
 */
export function buildEndpoint(
  rpcUrl: string,
  headers?: Record<string, string>
): RpcEndpoint {
  return parseRpcUrl(resolveEnvRefs(rpcUrl), resolveHeaders(headers));
}

/**
 * Resolve chain id, RPC endpoint and metadata for a chain from the profile.
 * Never throws: a chain the profile cannot describe carries an error instead,
 * so fan-out commands can report it per chain.
 */
export function resolveChain(chain: string, profile: RpcProfile): ResolvedChain {
  const entry = profile.chains[chain];
  const hint = `evm chain set ${chain} <rpc-url>`;
  if (!entry) {
    return {
      chain,
      chainId: 0,
      endpoint: null,
      error: `Not in profile '${profile.name}' (${hint})`,
    };
  }

  const meta = {
    ...(entry.symbol ? { symbol: entry.symbol } : {}),
    ...(entry.coingecko_id ? { coingeckoId: entry.coingecko_id } : {}),
    ...(entry.explorer_api ? { explorerApi: entry.explorer_api } : {}),
  };

  if (!entry.chain_id) {
    return { chain, chainId: 0, endpoint: null, ...meta, error: `No chain_id set (${hint})` };
  }
  if (!entry.rpc_url) {
    return {
      chain,
      chainId: entry.chain_id,
      endpoint: null,
      ...meta,
      error: `No RPC URL configured (${hint})`,
    };
  }

  try {
    const endpoint = buildEndpoint(entry.rpc_url, entry.headers);
    return { chain, chainId: entry.chain_id, endpoint, ...meta };
  } catch (error) {
    return {
      chain,
      chainId: entry.chain_id,
      endpoint: null,
      ...meta,
      error: (error as Error).message,
    };
  }
}
