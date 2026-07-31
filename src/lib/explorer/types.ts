/**
 * Types shared by the explorer client and the source resolution.
 *
 * Every source speaks the Etherscan v2 dialect: Blockscout's Pro API mirrors it
 * parameter for parameter, and a chain's own explorer_api is an
 * Etherscan-compatible endpoint by definition. So one client covers all of them
 * and an endpoint differs only in base URL, key, and how the chain is selected.
 */

/** Sources the profile can configure, in the order they are tried */
export const EXPLORER_NAMES = ['etherscan', 'blockscout'] as const;

export type ExplorerName = (typeof EXPLORER_NAMES)[number];

/** Profile section: one API key per source. Values may hold ${VAR} references. */
export type ExplorerSettings = Partial<Record<ExplorerName, string>>;

/** One endpoint ready to be queried */
export interface ExplorerEndpoint {
  /** Reported as the answering source; a chain's own endpoint reports as its chain name */
  source: string;
  baseUrl: string;
  apiKey?: string;
  /**
   * Multichain endpoints pick the chain with a chainid parameter. A chain's own
   * explorer_api serves one chain already, so it carries no chain id.
   */
  chainId?: number;
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
