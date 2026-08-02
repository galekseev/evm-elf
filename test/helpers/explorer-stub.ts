/**
 * An Etherscan-dialect API on 127.0.0.1 that answers from a fixed table.
 *
 * A chain entry's `explorer_api` is tried before the shipped Etherscan and
 * Blockscout endpoints, so pointing it at this stub is all it takes to reach
 * the explorer-backed paths — the verified implementation name, the upgrade
 * history, the creation record, and the ProxyAdmin trace — with no URL patched
 * anywhere.
 *
 * It covers only the three actions the CLI calls, plus the rejection every
 * source answers with when it does not like the key.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { zeroPadValue } from 'ethers';
import type { TestLifecycle } from './cli.js';

export interface ExplorerRequest {
  /** Path and query, as the client built it */
  url: string;
  module: string;
  action: string;
  /** The address the action was about, from whichever parameter carries it */
  address?: string;
  /** Present only on a shared source; a chain's own explorer_api carries none */
  apiKey?: string;
  /** Present only on a shared source, which selects the chain with it */
  chainId?: string;
  topic0?: string;
}

export interface ExplorerLogFixture {
  topics: string[];
  data?: string;
  blockNumber?: number;
  timestamp?: number;
}

export interface ExplorerAccountFixture {
  /** The verified contract name; absent means the source is not verified */
  name?: string;
  creation?: { txHash: string; creator: string };
  /** getLogs answers, keyed by topic0 */
  logs?: Record<string, ExplorerLogFixture[]>;
}

export interface ExplorerStubOptions {
  /** Keyed by address, matched case-insensitively */
  accounts?: Record<string, ExplorerAccountFixture>;
  /**
   * Answer every request with an Etherscan-shaped rejection carrying this
   * reason, the way a source out of quota or handed a bad key does.
   */
  rejects?: string;
}

export interface ExplorerStub {
  /** Goes into a chain's `explorer_api` */
  url: string;
  port: number;
  /** Every request the CLI made, in order */
  requests: ExplorerRequest[];
  /** Actions called, in order */
  actions(): string[];
  close(): Promise<void>;
}

interface Envelope {
  status: string;
  message: string;
  result: unknown;
}

const ok = (result: unknown): Envelope => ({ status: '1', message: 'OK', result });
const notOk = (message: string, result: unknown = []): Envelope => ({
  status: '0',
  message,
  result,
});

/** Etherscan reports both numbers as hex strings; the client accepts either */
const hex = (value: number): string => `0x${value.toString(16)}`;

/** The 32-byte topic an indexed address is logged as */
export const addressTopic = (address: string): string => zeroPadValue(address, 32);

function answer(
  request: ExplorerRequest,
  accounts: Map<string, ExplorerAccountFixture>
): Envelope {
  const account = request.address ? accounts.get(request.address.toLowerCase()) : undefined;

  if (request.action === 'getsourcecode') {
    if (!account) {
      return notOk('NOTOK', 'Contract source code not verified');
    }
    return ok([
      account.name
        ? { ContractName: account.name, SourceCode: `contract ${account.name} {}` }
        : { ContractName: '', SourceCode: '' },
    ]);
  }

  if (request.action === 'getcontractcreation') {
    if (!account?.creation) {
      return notOk('No data found');
    }
    return ok([
      {
        contractAddress: request.address,
        contractCreator: account.creation.creator,
        txHash: account.creation.txHash,
      },
    ]);
  }

  if (request.action === 'getLogs') {
    const logs = request.topic0 ? account?.logs?.[request.topic0.toLowerCase()] : undefined;
    if (!logs) {
      return notOk('No records found');
    }
    return ok(
      logs.map((log) => ({
        address: request.address,
        topics: log.topics,
        data: log.data ?? '0x',
        blockNumber: hex(log.blockNumber ?? 1),
        timeStamp: hex(log.timestamp ?? 1_700_000_000),
      }))
    );
  }

  return notOk('NOTOK', `stub has no answer for ${request.module}/${request.action}`);
}

export async function startExplorerStub(
  t: TestLifecycle,
  options: ExplorerStubOptions = {}
): Promise<ExplorerStub> {
  const { accounts = {}, rejects } = options;
  const table = new Map(
    Object.entries(accounts).map(([address, fixture]) => [address.toLowerCase(), fixture])
  );

  const requests: ExplorerRequest[] = [];

  const server: Server = createServer((incoming, response) => {
    const query = new URL(incoming.url ?? '/', 'http://127.0.0.1').searchParams;
    const request: ExplorerRequest = {
      url: incoming.url ?? '',
      module: query.get('module') ?? '',
      action: query.get('action') ?? '',
      ...(query.get('address') ?? query.get('contractaddresses')
        ? { address: query.get('address') ?? (query.get('contractaddresses') as string) }
        : {}),
      ...(query.get('apikey') ? { apiKey: query.get('apikey') as string } : {}),
      ...(query.get('chainid') ? { chainId: query.get('chainid') as string } : {}),
      ...(query.get('topic0') ? { topic0: query.get('topic0') as string } : {}),
    };
    requests.push(request);

    const body = rejects === undefined ? answer(request, table) : notOk('NOTOK', rejects);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, '127.0.0.1', resolvePromise);
  });

  const { port } = server.address() as AddressInfo;

  const close = (): Promise<void> =>
    new Promise((resolvePromise) => {
      server.closeAllConnections();
      server.close(() => resolvePromise());
    });

  t.onTestFinished(close);

  return {
    url: `http://127.0.0.1:${port}/api`,
    port,
    requests,
    actions: () => requests.map((request) => request.action),
    close,
  };
}
