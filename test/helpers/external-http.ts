/**
 * The two services the CLI reaches at a hardcoded address.
 *
 * RPC endpoints and a chain's own `explorer_api` come out of the profile, so a
 * test can point them at a real loopback server and keep the fidelity. CoinGecko
 * and the multichain explorer APIs cannot be pointed anywhere, so they are the
 * one place where the boundary itself is replaced.
 *
 * An unmatched request throws rather than falling through: a silent passthrough
 * would let a test claim to be offline while reaching the internet, which is the
 * failure this exists to prevent.
 */

import { vi } from 'vitest';

export interface ExternalRequest {
  url: string;
  headers: Record<string, string>;
}

export type Route = (url: URL) => unknown;

export interface ExternalHttp {
  /** Every request the stub answered, in order */
  requests: ExternalRequest[];
  urls(): string[];
}

export const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price';
export const ETHERSCAN = 'https://api.etherscan.io/v2/api';
export const BLOCKSCOUT = 'https://api.blockscout.com/v2/api';

/** An Etherscan-dialect success envelope */
export function etherscanOk(result: unknown): Record<string, unknown> {
  return { status: '1', message: 'OK', result };
}

/** How every Etherscan-dialect source reports a key it will not accept */
export function etherscanRejects(reason: string): Record<string, unknown> {
  return { status: '0', message: 'NOTOK', result: reason };
}

/**
 * Answer the listed prefixes and nothing else, for the duration of the test.
 * `unstubGlobals` puts the real fetch back.
 */
export function stubExternalHttp(routes: Record<string, Route>): ExternalHttp {
  const requests: ExternalRequest[] = [];

  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = input instanceof URL ? input.href : String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>)
    );
    requests.push({ url, headers });

    const prefix = Object.keys(routes).find((candidate) => url.startsWith(candidate));
    if (!prefix) {
      throw new Error(
        `Unstubbed request to ${url}. Add a route for it, or the test is reaching a real service.`
      );
    }

    const body = routes[prefix](new URL(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return { requests, urls: () => requests.map((request) => request.url) };
}
