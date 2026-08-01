/**
 * chain set command - add a chain to a profile or change an existing one.
 *
 * The chain id is read from the endpoint itself (eth_chainId) rather than from a
 * built-in table, so any chain works and the id is verified rather than assumed.
 */

import { existsSync } from 'fs';
import chalk from 'chalk';
import type { ChainConfig, ChainSetOptions } from '../../types.js';
import { buildEndpoint, loadBundledChains, resolveProfileTarget } from '../../lib/chains.js';
import {
  getChain,
  readProfileDocument,
  setChain,
  writeProfileDocument,
  type ChainEdit,
} from '../../lib/profile-file.js';
import { createDetectingProvider, type RpcEndpoint } from '../../lib/rpc.js';

const VERIFY_TIMEOUT_MS = 5000;
const CHAIN_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function fail(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

function parseHeaderArg(raw: string): [string, string] {
  const separator = raw.indexOf(':');
  if (separator <= 0) {
    fail(`Invalid --header '${raw}': expected <name>:<value>`);
  }
  const name = raw.slice(0, separator).trim();
  const value = raw.slice(separator + 1).trim();
  if (!name || !value) {
    fail(`Invalid --header '${raw}': expected <name>:<value>`);
  }
  return [name, value];
}

/** eth_chainId against the endpoint, with the headers already applied */
async function detectChainId(endpoint: RpcEndpoint): Promise<number> {
  const provider = createDetectingProvider(endpoint);
  let timer: NodeJS.Timeout | undefined;
  try {
    const network = await Promise.race([
      provider.getNetwork(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no response in ${VERIFY_TIMEOUT_MS}ms`)),
          VERIFY_TIMEOUT_MS
        );
      }),
    ]);
    return Number(network.chainId);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    provider.destroy();
  }
}

export async function chainSetCommand(
  chain: string,
  rpcUrlArg: string | undefined,
  options: ChainSetOptions
): Promise<void> {
  if (!CHAIN_NAME.test(chain)) {
    fail(`Invalid chain name '${chain}': use letters, digits, '.', '_' or '-'`);
  }

  const { name: profileName, path: profilePath } = await resolveProfileTarget(options.profile);
  // Only the default profile is created on demand, so a -p that names anything
  // else is a typo rather than a request for a new profile.
  if (!existsSync(profilePath)) {
    fail(`Profile not found: ${profilePath}`);
  }
  const doc = await readProfileDocument(profilePath);
  const existing = getChain(doc, chain);

  const rpcUrl = rpcUrlArg?.trim() || existing?.rpc_url;
  if (!rpcUrl) {
    fail(`Chain '${chain}' is not in ${profilePath}: pass an RPC URL (evm chain set ${chain} <rpc-url>)`);
  }

  const addedHeaders = Object.fromEntries((options.header ?? []).map(parseHeaderArg));
  const removeHeaders = options.removeHeader ?? [];
  const headers = { ...existing?.headers, ...addedHeaders };
  for (const name of removeHeaders) {
    delete headers[name];
  }

  let expectedId: number | undefined = existing?.chain_id;
  if (options.chainId !== undefined) {
    expectedId = Number(options.chainId);
    if (!Number.isInteger(expectedId) || expectedId <= 0) {
      fail(`Invalid --chain-id '${options.chainId}': expected a positive integer`);
    }
  }

  const verifyHint = 'Pass --no-verify --chain-id <id> to write the entry anyway.';
  let chainId: number;
  if (options.verify === false) {
    if (expectedId === undefined) {
      fail('--no-verify needs --chain-id, since the chain id cannot be read from the RPC');
    }
    chainId = expectedId;
  } else {
    // ${VAR} is only resolved to reach the endpoint, so an entry can be written
    // for variables that are not in this shell as long as it is not verified.
    let endpoint: RpcEndpoint;
    try {
      endpoint = buildEndpoint(rpcUrl, headers);
    } catch (error) {
      fail(`${(error as Error).message}\n${verifyHint}`);
    }

    let detected: number;
    try {
      detected = await detectChainId(endpoint);
    } catch (error) {
      fail(
        `Could not read the chain id from ${endpoint.url}: ${(error as Error).message}\n${verifyHint}`
      );
    }
    if (expectedId !== undefined && expectedId !== detected) {
      fail(
        `Chain id mismatch: ${endpoint.url} reports ${detected}, expected ${expectedId}. Nothing written.`
      );
    }
    chainId = detected;
  }

  // Metadata cannot be read from an RPC, so fill in what the entry is missing
  // from the bundled profile, matched on chain id so forks inherit it too.
  const bundled = await loadBundledChains();
  const suggested: ChainConfig =
    Object.values(bundled).find((entry) => entry.chain_id === chainId) ?? {};

  const edit: ChainEdit = {
    chain_id: chainId,
    rpc_url: rpcUrl,
    ...(Object.keys(addedHeaders).length > 0 ? { headers: addedHeaders } : {}),
    ...(removeHeaders.length > 0 ? { removeHeaders } : {}),
  };
  const symbol = options.symbol ?? existing?.symbol ?? suggested.symbol;
  const coingeckoId = options.coingeckoId ?? existing?.coingecko_id ?? suggested.coingecko_id;
  const explorerApi = options.explorerApi ?? existing?.explorer_api ?? suggested.explorer_api;
  if (symbol !== undefined) {
    edit.symbol = symbol;
  }
  if (coingeckoId !== undefined) {
    edit.coingecko_id = coingeckoId;
  }
  if (explorerApi !== undefined) {
    edit.explorer_api = explorerApi;
  }

  setChain(doc, chain, edit);
  await writeProfileDocument(profilePath, doc);

  const written = getChain(doc, chain) ?? {};
  if (options.json) {
    console.log(
      JSON.stringify(
        { profile: profileName, path: profilePath, added: !existing, chain, config: written },
        null,
        2
      )
    );
    return;
  }

  console.log(
    existing
      ? `Updated ${chalk.bold(chain)} in ${chalk.dim(profilePath)}`
      : `Added ${chalk.bold(chain)} to ${chalk.dim(profilePath)}`
  );
  console.log(`  chain_id     ${chalk.cyan(chainId)}`);
  console.log(`  rpc_url      ${chalk.cyan(written.rpc_url ?? '-')}`);
  if (written.symbol) {
    console.log(`  symbol       ${written.symbol}`);
  }
  if (written.coingecko_id) {
    console.log(`  coingecko_id ${written.coingecko_id}`);
  }
  if (written.explorer_api) {
    console.log(`  explorer_api ${written.explorer_api}`);
  }
  const headerNames = Object.keys(written.headers ?? {});
  if (headerNames.length > 0) {
    console.log(`  headers      ${headerNames.join(', ')}`);
  }
}
