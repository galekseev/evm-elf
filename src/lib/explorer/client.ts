/**
 * Minimal Etherscan-dialect API client.
 *
 * Every function returns null when the endpoint could not answer, which is what
 * makes the caller move on to the next source. A negative but valid answer, such
 * as an unverified contract, is returned as data instead.
 */

import type {
  ContractCreation,
  ExplorerContractInfo,
  ExplorerEndpoint,
  ExplorerLog,
} from './types.js';

/** Well-known verified contract used to check that a key is accepted */
const PROBE_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const PROBE_CHAIN_ID = 1;
const PROBE_TIMEOUT_MS = 5000;

interface ExplorerResponse<T> {
  status?: string;
  message?: string;
  result?: T;
  /** Blockscout reports auth failures outside the Etherscan envelope */
  error?: string;
}

function buildUrl(endpoint: ExplorerEndpoint, query: string): string {
  const params = [
    ...(endpoint.chainId !== undefined ? [`chainid=${endpoint.chainId}`] : []),
    query,
    ...(endpoint.apiKey ? [`apikey=${encodeURIComponent(endpoint.apiKey)}`] : []),
  ];
  return `${endpoint.baseUrl}?${params.join('&')}`;
}

async function fetchExplorer<T>(
  endpoint: ExplorerEndpoint,
  query: string,
  timeoutMs?: number
): Promise<ExplorerResponse<T> | null> {
  try {
    const response = await fetch(buildUrl(endpoint, query), {
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    return (await response.json()) as ExplorerResponse<T>;
  } catch {
    return null;
  }
}

function parseHexOrDecimal(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = value.startsWith('0x') ? parseInt(value, 16) : parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Get the creation transaction of a contract, or null when the endpoint could
 * not answer.
 */
export async function getContractCreation(
  endpoint: ExplorerEndpoint,
  address: string
): Promise<ContractCreation | null> {
  const body = await fetchExplorer<{ txHash?: string; contractCreator?: string }[] | string>(
    endpoint,
    `module=contract&action=getcontractcreation&contractaddresses=${address}`
  );
  if (!body || body.status !== '1' || !Array.isArray(body.result) || body.result.length === 0) {
    return null;
  }
  const entry = body.result[0];
  if (!entry.txHash || !entry.contractCreator) {
    return null;
  }
  return { txHash: entry.txHash, creator: entry.contractCreator };
}

/**
 * Get the verified contract name for an address (getsourcecode).
 * Returns null when the endpoint could not answer; { verified: false } when the
 * contract exists but its source is not verified.
 */
export async function getContractInfo(
  endpoint: ExplorerEndpoint,
  address: string
): Promise<ExplorerContractInfo | null> {
  const body = await fetchExplorer<{ ContractName?: string; SourceCode?: string }[] | string>(
    endpoint,
    `module=contract&action=getsourcecode&address=${address}`
  );
  if (!body || body.status !== '1' || !Array.isArray(body.result) || body.result.length === 0) {
    return null;
  }
  const entry = body.result[0];
  const verified = !!entry.SourceCode && entry.SourceCode.length > 0;
  return { name: verified ? entry.ContractName : undefined, verified };
}

/**
 * Fetch event logs for an address filtered by topic0.
 * Returns [] when the endpoint reports no matching records, null when it could
 * not answer.
 */
export async function getLogsByTopic(
  endpoint: ExplorerEndpoint,
  address: string,
  topic0: string
): Promise<ExplorerLog[] | null> {
  const body = await fetchExplorer<
    { topics?: string[]; data?: string; blockNumber?: string; timeStamp?: string }[] | string
  >(
    endpoint,
    `module=logs&action=getLogs&address=${address}&topic0=${topic0}&fromBlock=0&toBlock=latest&page=1&offset=1000`
  );
  if (!body) {
    return null;
  }
  if (body.status !== '1') {
    return body.message?.toLowerCase().includes('no records') ? [] : null;
  }
  if (!Array.isArray(body.result)) {
    return null;
  }
  return body.result.map((log) => ({
    topics: log.topics ?? [],
    data: log.data ?? '0x',
    blockNumber: parseHexOrDecimal(log.blockNumber) ?? 0,
    timestamp: parseHexOrDecimal(log.timeStamp),
  }));
}

export type ProbeResult = { ok: true } | { ok: false; reason: string };

/**
 * Check that an endpoint accepts its key, by asking for a contract that has been
 * verified on every explorer for years. A rejected key is the one failure worth
 * catching early: it surfaces later only as fields quietly going missing.
 */
export async function probeExplorer(endpoint: ExplorerEndpoint): Promise<ProbeResult> {
  const target: ExplorerEndpoint = {
    ...endpoint,
    ...(endpoint.chainId !== undefined ? { chainId: PROBE_CHAIN_ID } : {}),
  };
  const body = await fetchExplorer<unknown>(
    target,
    `module=contract&action=getsourcecode&address=${PROBE_ADDRESS}`,
    PROBE_TIMEOUT_MS
  );

  if (!body) {
    return { ok: false, reason: `no usable response from ${endpoint.baseUrl}` };
  }
  if (body.status === '1') {
    return { ok: true };
  }
  // Etherscan puts the reason in result ("Invalid API Key"), Blockscout in error
  const reason =
    (typeof body.result === 'string' && body.result) || body.error || body.message || 'rejected';
  return { ok: false, reason };
}
