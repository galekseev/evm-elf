/**
 * RPC endpoint parsing and ethers provider construction
 * Supports the `<URL>|<AUTH_KEY_HTTP_HEADER>` RPC format
 */

import { FetchRequest, JsonRpcProvider } from 'ethers';

export interface RpcEndpoint {
  url: string;
  authKeyHeader?: string;
}

/**
 * Parse RPC URL in @1inch/solidity-utils format: `<URL>` or `<URL>|<AUTH_KEY_HTTP_HEADER>`.
 */
export function parseRpcUrl(raw: string): RpcEndpoint {
  const [url, authKeyHeader, overflow] = raw.split('|');
  if (overflow !== undefined || !url) {
    throw new Error(`Invalid RPC URL: expected <URL> or <URL>|<AUTH_KEY>, got: ${raw}`);
  }
  return { url, authKeyHeader: authKeyHeader || undefined };
}

/**
 * Create an ethers provider for an endpoint, attaching the auth-key header if present.
 * staticNetwork avoids an extra eth_chainId roundtrip per request.
 */
export function createProvider(endpoint: RpcEndpoint, chainId: number): JsonRpcProvider {
  const req = new FetchRequest(endpoint.url);
  if (endpoint.authKeyHeader) {
    req.setHeader('auth-key', endpoint.authKeyHeader);
  }
  return new JsonRpcProvider(req, chainId, { staticNetwork: true });
}
