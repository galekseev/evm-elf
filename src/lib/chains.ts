/**
 * Chain resolution: chain list, RPC profiles, RPC endpoints
 * Chain selection order:
 *   -c filter > chains named by the profile > every known chain
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { isAbsolute, resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import type { KnownChains, RpcProfile, RpcProfileChain } from '../types.js';
import {
  BUNDLED_CHAINS_PATH,
  PROFILES_DIR,
  USER_CHAINS_PATH,
  resolveEnvRefs,
} from './env.js';
import { parseRpcUrl, type RpcEndpoint } from './rpc.js';

async function readChainFile(path: string): Promise<KnownChains> {
  try {
    const parsed = parseYaml(await readFile(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as KnownChains) : {};
  } catch {
    return {};
  }
}

/**
 * Chain name -> chain id. The bundled list is the baseline; a user file at
 * ~/.config/evm-elf/chains.yaml adds to it and can redefine existing entries.
 */
export async function loadKnownChains(): Promise<KnownChains> {
  const [bundled, user] = await Promise.all([
    readChainFile(BUNDLED_CHAINS_PATH),
    readChainFile(USER_CHAINS_PATH),
  ]);
  return { ...bundled, ...user };
}

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

export async function loadProfile(nameOrPath: string): Promise<RpcProfile> {
  const filePath = resolveProfilePath(nameOrPath);
  if (!existsSync(filePath)) {
    throw new Error(`Profile not found: ${filePath}`);
  }
  const parsed = parseYaml(await readFile(filePath, 'utf-8')) as RpcProfile | null;
  if (!parsed?.chains || typeof parsed.chains !== 'object') {
    throw new Error(`Invalid profile ${filePath}: expected a top-level 'chains' mapping`);
  }
  return parsed;
}

function profileChainRpc(entry: RpcProfileChain | undefined): string | undefined {
  if (entry === undefined) {
    return undefined;
  }
  return typeof entry === 'string' ? entry : entry.rpc_url;
}

function profileChainId(entry: RpcProfileChain | undefined): number | undefined {
  return typeof entry === 'object' ? entry.chain_id : undefined;
}

export interface ResolvedChain {
  chain: string;
  chainId: number;
  endpoint: RpcEndpoint | null;
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
 * 2. chains named by the profile
 * 3. all known chains
 * With -xc (excludeFilter), the default list (2 or 3) is used minus the excluded chains.
 */
export function selectChains(
  chainFilter: string | undefined,
  excludeFilter: string | undefined,
  profile: RpcProfile | undefined,
  knownChains: KnownChains
): string[] {
  if (chainFilter) {
    return parseChainList(chainFilter);
  }
  const base = profile ? Object.keys(profile.chains) : Object.keys(knownChains);
  if (!excludeFilter) {
    return base;
  }
  const excluded = new Set(parseChainList(excludeFilter));
  for (const name of excluded) {
    if (!base.includes(name)) {
      console.error(`Warning: excluded chain '${name}' is not in the chain list`);
    }
  }
  return base.filter((c) => !excluded.has(c));
}

/**
 * Convert chain name to RPC URL env var name (e.g. "base" -> "BASE_RPC_URL")
 */
function chainToEnvVar(chain: string): string {
  return `${chain.toUpperCase()}_RPC_URL`;
}

/**
 * Resolve chain ID and RPC endpoint for a chain.
 * Priority: profile > environment variable.
 */
export function resolveChain(
  chain: string,
  profile: RpcProfile | undefined,
  knownChains: KnownChains
): ResolvedChain {
  const entry = profile?.chains[chain];
  const chainId = profileChainId(entry) ?? knownChains[chain];

  if (!chainId) {
    return { chain, chainId: 0, endpoint: null, error: 'Unknown chain' };
  }

  // Profile RPC takes priority
  const rawUrl = profileChainRpc(entry) ?? process.env[chainToEnvVar(chain)];
  if (!rawUrl) {
    return { chain, chainId, endpoint: null, error: 'No RPC URL configured' };
  }

  try {
    const endpoint = parseRpcUrl(resolveEnvRefs(rawUrl));
    return { chain, chainId, endpoint };
  } catch (error) {
    return { chain, chainId, endpoint: null, error: (error as Error).message };
  }
}
