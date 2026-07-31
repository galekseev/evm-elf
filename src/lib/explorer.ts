/**
 * Minimal block explorer API client (contract creation lookups)
 * Uses the Etherscan v2 multichain API unless the chain names its own
 * Etherscan-compatible API (explorer_api in the profile, e.g. zksync Era).
 */

const ETHERSCAN_V2_API = 'https://api.etherscan.io/v2/api';

export interface ExplorerTarget {
  chainId: number;
  /** Etherscan-compatible API for chains outside Etherscan v2 (no key required) */
  apiUrl?: string;
}

export interface ContractCreation {
  txHash: string;
  creator: string;
}

export interface ExplorerContractInfo {
  name?: string;
  verified: boolean;
}

export interface ExplorerLog {
  topics: string[];
  data: string;
  blockNumber: number;
  timestamp?: number;
}

function buildUrl(target: ExplorerTarget, query: string): string {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  return target.apiUrl
    ? `${target.apiUrl}?${query}`
    : `${ETHERSCAN_V2_API}?chainid=${target.chainId}&${query}${apiKey ? `&apikey=${apiKey}` : ''}`;
}

async function fetchExplorer<T>(url: string): Promise<{ status: string; message?: string; result?: T } | null> {
  try {
    const response = await fetch(url);
    return (await response.json()) as { status: string; message?: string; result?: T };
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
 * Get the creation transaction of a contract, or null when the chain has no
 * supported explorer API / the lookup fails. Uses ETHERSCAN_API_KEY when set.
 */
export async function getContractCreation(
  target: ExplorerTarget,
  address: string
): Promise<ContractCreation | null> {
  const url = buildUrl(
    target,
    `module=contract&action=getcontractcreation&contractaddresses=${address}`
  );
  const body = await fetchExplorer<{ txHash?: string; contractCreator?: string }[] | string>(url);
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
 * Returns null when the explorer is unavailable; { verified: false } when the
 * contract exists but its source is not verified.
 */
export async function getContractInfo(
  target: ExplorerTarget,
  address: string
): Promise<ExplorerContractInfo | null> {
  const url = buildUrl(target, `module=contract&action=getsourcecode&address=${address}`);
  const body = await fetchExplorer<{ ContractName?: string; SourceCode?: string }[] | string>(url);
  if (!body || body.status !== '1' || !Array.isArray(body.result) || body.result.length === 0) {
    return null;
  }
  const entry = body.result[0];
  const verified = !!entry.SourceCode && entry.SourceCode.length > 0;
  return { name: verified ? entry.ContractName : undefined, verified };
}

/**
 * Fetch event logs for an address filtered by topic0.
 * Returns [] when the explorer reports no matching records, null on failure
 * or when the chain has no supported explorer API.
 */
export async function getLogsByTopic(
  target: ExplorerTarget,
  address: string,
  topic0: string
): Promise<ExplorerLog[] | null> {
  const url = buildUrl(
    target,
    `module=logs&action=getLogs&address=${address}&topic0=${topic0}&fromBlock=0&toBlock=latest&page=1&offset=1000`
  );
  const body = await fetchExplorer<
    { topics?: string[]; data?: string; blockNumber?: string; timeStamp?: string }[] | string
  >(url);
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
