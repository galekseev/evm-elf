/**
 * Explorer source resolution and fallback.
 *
 * A chain is served by an ordered list of endpoints: the chain's own
 * explorer_api first, then the multichain sources configured in the profile.
 * Each operation walks that list on its own and stops at the first endpoint that
 * answers, so a source that is down or out of quota costs one request rather
 * than the whole field.
 */

import { tryResolveEnvRefs } from '../env.js';
import {
  getContractCreation,
  getContractInfo,
  getLogsByTopic,
  probeExplorer,
  type ProbeResult,
} from './client.js';
import {
  EXPLORER_NAMES,
  type ContractCreation,
  type ExplorerContractInfo,
  type ExplorerEndpoint,
  type ExplorerLog,
  type ExplorerName,
  type ExplorerSettings,
} from './types.js';

export {
  EXPLORER_NAMES,
  type ContractCreation,
  type ExplorerContractInfo,
  type ExplorerEndpoint,
  type ExplorerLog,
  type ExplorerName,
  type ExplorerSettings,
} from './types.js';

/** Multichain endpoints, both selecting the chain with a chainid parameter */
const BASE_URLS: Record<ExplorerName, string> = {
  etherscan: 'https://api.etherscan.io/v2/api',
  blockscout: 'https://api.blockscout.com/v2/api',
};

export function isExplorerName(value: string): value is ExplorerName {
  return (EXPLORER_NAMES as readonly string[]).includes(value);
}

export function explorerBaseUrl(name: ExplorerName): string {
  return BASE_URLS[name];
}

/** Enough of a resolved chain to reach an explorer for it */
export interface ExplorerChainRef {
  chain: string;
  chainId: number;
  explorerApi?: string;
}

/**
 * Endpoints to try for one chain, in order. A source whose key is missing, or
 * whose ${VAR} does not resolve, is left out: it could only fail on the wire.
 */
export function resolveEndpoints(
  settings: ExplorerSettings | undefined,
  chain: ExplorerChainRef
): ExplorerEndpoint[] {
  const endpoints: ExplorerEndpoint[] = [];

  if (chain.explorerApi) {
    endpoints.push({ source: chain.chain, baseUrl: chain.explorerApi });
  }

  for (const name of EXPLORER_NAMES) {
    const configured = settings?.[name];
    if (!configured) {
      continue;
    }
    const apiKey = tryResolveEnvRefs(configured);
    if (!apiKey) {
      continue;
    }
    endpoints.push({ source: name, baseUrl: BASE_URLS[name], apiKey, chainId: chain.chainId });
  }

  return endpoints;
}

/**
 * The explorer side of one chain's inspection. Holds which source answered, for
 * reporting, and whether a lookup was skipped for want of any source at all.
 */
export class ExplorerChain {
  private readonly endpoints: ExplorerEndpoint[];
  /** Source that answered first, reported so a surprising result can be traced */
  source?: string;
  /** A lookup was wanted but no endpoint was configured */
  skipped = false;

  constructor(settings: ExplorerSettings | undefined, chain: ExplorerChainRef) {
    this.endpoints = resolveEndpoints(settings, chain);
  }

  get configured(): boolean {
    return this.endpoints.length > 0;
  }

  private async walk<T>(
    call: (endpoint: ExplorerEndpoint) => Promise<T | null>
  ): Promise<T | null> {
    if (!this.configured) {
      this.skipped = true;
      return null;
    }
    for (const endpoint of this.endpoints) {
      const value = await call(endpoint);
      if (value !== null) {
        this.source ??= endpoint.source;
        return value;
      }
    }
    return null;
  }

  getContractCreation(address: string): Promise<ContractCreation | null> {
    return this.walk((endpoint) => getContractCreation(endpoint, address));
  }

  getContractInfo(address: string): Promise<ExplorerContractInfo | null> {
    return this.walk((endpoint) => getContractInfo(endpoint, address));
  }

  getLogsByTopic(address: string, topic0: string): Promise<ExplorerLog[] | null> {
    return this.walk((endpoint) => getLogsByTopic(endpoint, address, topic0));
  }
}

/** Check that a source accepts a key, before it is written to a profile */
export function verifyExplorerKey(name: ExplorerName, apiKey: string): Promise<ProbeResult> {
  return probeExplorer({ source: name, baseUrl: BASE_URLS[name], apiKey, chainId: 1 });
}
