/**
 * RPC endpoint parsing and ethers provider construction
 * Headers come from the profile; `<URL>|<AUTH_KEY_HTTP_HEADER>` is accepted as
 * shorthand for the auth-key header.
 */

import { FetchRequest, JsonRpcProvider } from 'ethers';

const AUTH_KEY_HEADER = 'auth-key';

export interface RpcEndpoint {
  url: string;
  headers?: Record<string, string>;
}

/**
 * Parse an RPC URL in @1inch/solidity-utils format: `<URL>` or
 * `<URL>|<AUTH_KEY_HTTP_HEADER>`, the latter becoming an auth-key header.
 */
export function parseRpcUrl(raw: string, headers?: Record<string, string>): RpcEndpoint {
  const [url, authKey, overflow] = raw.split('|');
  if (overflow !== undefined || !url) {
    throw new Error(`Invalid RPC URL: expected <URL> or <URL>|<AUTH_KEY>, got: ${raw}`);
  }
  const merged = { ...headers, ...(authKey ? { [AUTH_KEY_HEADER]: authKey } : {}) };
  return { url, ...(Object.keys(merged).length > 0 ? { headers: merged } : {}) };
}

/**
 * Create an ethers provider for an endpoint, attaching its headers.
 * staticNetwork avoids an extra eth_chainId roundtrip per request.
 */
export function createProvider(endpoint: RpcEndpoint, chainId: number): JsonRpcProvider {
  return new JsonRpcProvider(buildRequest(endpoint), chainId, { staticNetwork: true });
}

/**
 * Provider for an endpoint whose chain id is not known yet, so ethers detects
 * the network itself (used when adding a chain to a profile).
 */
export function createDetectingProvider(endpoint: RpcEndpoint): JsonRpcProvider {
  return new JsonRpcProvider(buildRequest(endpoint), undefined, { staticNetwork: false });
}

function buildRequest(endpoint: RpcEndpoint): FetchRequest {
  const req = new FetchRequest(endpoint.url);
  for (const [name, value] of Object.entries(endpoint.headers ?? {})) {
    req.setHeader(name, value);
  }
  return req;
}
