/**
 * A JSON-RPC endpoint on 127.0.0.1 that answers from a fixed table.
 *
 * It exists so that the paths which only run once a chain answers — chain-id
 * detection, a populated balance row, header forwarding, proxy detection — can
 * be characterized without reaching a public network. Nothing here models a
 * real node beyond the handful of methods those paths call.
 *
 * Beyond the flat table, an address can be given a fixture: bytecode, storage
 * slots, a balance, and answers to the `eth_call`s the proxy commands make.
 * `proxyAccounts` builds the seven shapes `contract proxy-info` detects out of
 * those parts, using the slot constants imported from the source rather than
 * copies of them, so a changed constant fails the test rather than the fixture.
 *
 * An answer may also be a failure: `reverts` puts a node's own revert response
 * in the table, which is the only way a fixture can say what a simulated write
 * would have done.
 */

import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net';
import { AbiCoder, getAddress, id, keccak256, toBeHex, zeroPadValue } from 'ethers';
import type { TestLifecycle } from './cli.js';
import {
  ADMIN_CHANGED_TOPIC,
  EIP1967_ADMIN_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  INITIALIZABLE_SLOT_V5,
} from '../../src/lib/proxy.js';

export interface RpcCall {
  method: string;
  params: unknown[];
  headers: Record<string, string>;
}

export type RpcHandler = (params: unknown[]) => unknown;

/**
 * A JSON-RPC error in place of a result. Returned by a handler or held in a
 * fixture's call table; the server turns it into the `error` member of the
 * response.
 */
export class RpcErrorAnswer {
  constructor(
    readonly code: number,
    readonly message: string,
    readonly data?: string
  ) {}
}

/** One address as the stub knows it */
export interface AccountFixture {
  /** eth_getCode; absent means the address holds no code */
  code?: string;
  /** eth_getBalance, overriding the stub-wide default */
  balanceWei?: bigint;
  /** eth_getStorageAt, keyed by slot in any hex or decimal form */
  storage?: Record<string, string>;
  /**
   * eth_call answers, keyed by the signature the CLI calls, e.g. `owner()`.
   * Return data, or a `reverts()` for a call that fails.
   */
  calls?: Record<string, string | RpcErrorAnswer>;
}

/** Enough of a receipt for the logs the ProxyAdmin trace reads */
export interface ReceiptFixture {
  blockNumber?: number;
  logs?: { address: string; topics: string[]; data?: string }[];
}

export interface RpcStubOptions {
  chainId?: number;
  balanceWei?: bigint;
  transactionCount?: number;
  code?: string;
  /** Per-address bytecode, storage, balance and eth_call answers */
  accounts?: Record<string, AccountFixture>;
  /** eth_getTransactionReceipt, keyed by transaction hash */
  receipts?: Record<string, ReceiptFixture>;
  /** Timestamp every block reports, which is where a creation date comes from */
  blockTimestamp?: number;
  /**
   * Accept signed transactions and report them as mined, for the `--exec`
   * paths. The hash returned is keccak256 of the raw transaction, which is what
   * ethers computed locally and checks the node's answer against.
   */
  mineTransactions?: boolean;
  /** Overrides and additions, keyed by JSON-RPC method name */
  handlers?: Record<string, RpcHandler>;
}

export interface RpcStub {
  url: string;
  port: number;
  /** Every request the CLI made, in order */
  calls: RpcCall[];
  /** Methods called, in order, deduplicated for readability */
  methods(): string[];
  close(): Promise<void>;
}

function hex(value: bigint | number): string {
  return `0x${value.toString(16)}`;
}

const ZERO_WORD = `0x${'00'.repeat(32)}`;
const SOME_HASH = `0x${'ab'.repeat(32)}`;

/** ABI-encoded return data for the view functions the proxy commands call */
const coder = AbiCoder.defaultAbiCoder();
export const returns = {
  address: (value: string): string => coder.encode(['address'], [value]),
  addresses: (values: string[]): string => coder.encode(['address[]'], [values]),
  bool: (value: boolean): string => coder.encode(['bool'], [value]),
  string: (value: string): string => coder.encode(['string'], [value]),
  bytes32: (value: string): string => coder.encode(['bytes32'], [value]),
  uint: (value: bigint | number): string => coder.encode(['uint256'], [value]),
};

/**
 * The response a node gives a call that reverted with a reason: error code 3,
 * and the `Error(string)` revert data ethers decodes the reason back out of.
 * The selector is derived rather than quoted, like the slots above.
 */
export function reverts(reason: string): RpcErrorAnswer {
  const data = id('Error(string)').slice(0, 10) + returns.string(reason).slice(2);
  return new RpcErrorAnswer(3, `execution reverted: ${reason}`, data);
}

/** A storage word holding an address or a small integer */
export function slotValue(value: string | bigint | number): string {
  return zeroPadValue(typeof value === 'string' ? value : toBeHex(value), 32);
}

/** Slots and call keys are matched by value, not by the spelling of the hex */
const slotKey = (value: unknown): string => BigInt(value as string).toString(16);
const selector = (signature: string): string => id(signature).slice(0, 10);

function expandReceipt(hash: string, fixture: ReceiptFixture): Record<string, unknown> {
  const blockNumber = fixture.blockNumber ?? 1;
  return {
    transactionHash: hash,
    transactionIndex: hex(0),
    blockHash: SOME_HASH,
    blockNumber: hex(blockNumber),
    from: `0x${'00'.repeat(20)}`,
    to: null,
    contractAddress: null,
    cumulativeGasUsed: hex(21_000),
    gasUsed: hex(21_000),
    effectiveGasPrice: hex(1_000_000_000),
    logsBloom: `0x${'00'.repeat(256)}`,
    status: hex(1),
    type: hex(2),
    logs: (fixture.logs ?? []).map((log, index) => ({
      address: log.address,
      topics: log.topics,
      data: log.data ?? '0x',
      blockNumber: hex(blockNumber),
      blockHash: SOME_HASH,
      transactionHash: hash,
      transactionIndex: hex(0),
      logIndex: hex(index),
      removed: false,
    })),
  };
}

function block(number: string, timestamp: number): Record<string, unknown> {
  return {
    hash: SOME_HASH,
    parentHash: SOME_HASH,
    number,
    timestamp: hex(timestamp),
    nonce: '0x0000000000000000',
    difficulty: hex(0),
    gasLimit: hex(30_000_000),
    gasUsed: hex(21_000),
    miner: `0x${'00'.repeat(20)}`,
    extraData: '0x',
    baseFeePerGas: hex(1_000_000_000),
    transactions: [],
  };
}

export async function startRpcStub(t: TestLifecycle, options: RpcStubOptions = {}): Promise<RpcStub> {
  const {
    chainId = 8453,
    balanceWei = 1_500_000_000_000_000_000n,
    transactionCount = 7,
    code = '0x',
    accounts = {},
    receipts = {},
    blockTimestamp = 1_700_000_000,
    mineTransactions = false,
    handlers = {},
  } = options;

  const fixtures = new Map(
    Object.entries(accounts).map(([address, fixture]) => [address.toLowerCase(), fixture])
  );
  const at = (address: unknown): AccountFixture | undefined =>
    fixtures.get(String(address).toLowerCase());

  const table: Record<string, RpcHandler> = {
    eth_chainId: () => hex(chainId),
    net_version: () => String(chainId),
    eth_blockNumber: () => hex(1),
    eth_getBalance: (params) => hex(at(params[0])?.balanceWei ?? balanceWei),
    eth_getTransactionCount: () => hex(transactionCount),
    eth_getCode: (params) => at(params[0])?.code ?? code,
    eth_getStorageAt: (params) => {
      const storage = at(params[0])?.storage ?? {};
      const wanted = slotKey(params[1]);
      for (const [slot, value] of Object.entries(storage)) {
        if (slotKey(slot) === wanted) {
          return value;
        }
      }
      return ZERO_WORD;
    },
    // An unanswered call returns no data, which is how ethers reports a
    // function the contract does not have: the caller's decode throws and the
    // command treats it as absent.
    eth_call: (params) => {
      const request = params[0] as { to?: string; data?: string };
      const calls = at(request.to)?.calls ?? {};
      for (const [signature, data] of Object.entries(calls)) {
        if (selector(signature) === request.data?.slice(0, 10)) {
          return data;
        }
      }
      return '0x';
    },
    eth_getTransactionReceipt: (params) => {
      const hash = String(params[0]);
      const fixture = receipts[hash] ?? receipts[hash.toLowerCase()];
      if (fixture) {
        return expandReceipt(hash, fixture);
      }
      // Without this a wait() on a transaction the test just broadcast would
      // poll until the run's timeout.
      return mineTransactions ? expandReceipt(hash, { blockNumber: 2 }) : null;
    },
    ...(mineTransactions
      ? { eth_sendRawTransaction: (params: unknown[]) => keccak256(String(params[0])) }
      : {}),
    // A block tag has to come back as the number it stands for: ethers reads
    // `number` as a quantity when it works out fee data, and echoing "latest"
    // makes the whole sweep fail on a BigInt conversion.
    eth_getBlockByNumber: (params) => {
      const wanted = String(params[0]);
      return block(wanted.startsWith('0x') ? wanted : hex(1), blockTimestamp);
    },
    eth_gasPrice: () => hex(1_000_000_000n),
    // What a healthy node answers a sweep, which works out its gas reserve
    // before it knows how much is left to send.
    eth_estimateGas: () => hex(21_000),
    eth_maxPriorityFeePerGas: () => hex(1_000_000n),
    ...handlers,
  };

  const calls: RpcCall[] = [];

  const server: Server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf-8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      const headers = Object.fromEntries(
        Object.entries(request.headers).map(([name, value]) => [
          name,
          Array.isArray(value) ? value.join(', ') : (value ?? ''),
        ])
      );

      const parsed: unknown = JSON.parse(body);
      const batch = Array.isArray(parsed) ? parsed : [parsed];
      const payloads = batch as { id: number; method: string; params?: unknown[] }[];

      const replies = payloads.map((payload) => {
        calls.push({ method: payload.method, params: payload.params ?? [], headers });
        const handler = table[payload.method];
        if (!handler) {
          return {
            jsonrpc: '2.0',
            id: payload.id,
            error: { code: -32601, message: `stub has no handler for ${payload.method}` },
          };
        }
        const answer = handler(payload.params ?? []);
        if (answer instanceof RpcErrorAnswer) {
          return {
            jsonrpc: '2.0',
            id: payload.id,
            error: {
              code: answer.code,
              message: answer.message,
              ...(answer.data === undefined ? {} : { data: answer.data }),
            },
          };
        }
        return { jsonrpc: '2.0', id: payload.id, result: answer };
      });

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
    });
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
    url: `http://127.0.0.1:${port}`,
    port,
    calls,
    methods: () => calls.map((call) => call.method),
    close,
  };
}

/** Addresses the proxy fixtures use, distinct enough to read in a diff */
export const PROXY = getAddress('0x0000000000000000000000000000000000000001');
export const IMPLEMENTATION = getAddress('0x1111111111111111111111111111111111111111');
export const ADMIN = getAddress('0x2222222222222222222222222222222222222222');
export const BEACON = getAddress('0x3333333333333333333333333333333333333333');
export const OWNER = getAddress('0x4444444444444444444444444444444444444444');
export const DEPLOYER = getAddress('0x5555555555555555555555555555555555555555');
/** The transparent proxy a ProxyAdmin administers, reached by the trace */
export const MANAGED_PROXY = getAddress('0x6666666666666666666666666666666666666666');
export const CREATION_TX = `0x${'cc'.repeat(32)}`;

/** Runtime bytecode carrying neither clone pattern nor a ProxyAdmin selector */
export const PLAIN_CODE = '0x6080604052348015600f57600080fd5b50';
export const IMPLEMENTATION_CODE = '0x60806040523415600e57600080fd5bfe';

/**
 * EIP-1167 and its EIP-7511 PUSH0 variant. Both embed the implementation in
 * the runtime bytecode, which is what `parseMinimalProxy` reads back out.
 */
export const clone = (implementation: string): string =>
  `0x363d3d373d3d3d363d73${implementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
export const clonePush0 = (implementation: string): string =>
  `0x365f5f375f5f365f73${implementation.slice(2).toLowerCase()}5af43d5f5f3e5f3d91602a57fd5bf3`;

/**
 * A dispatcher holding the two selectors `looksLikeProxyAdmin` looks for:
 * upgradeAndCall(address,address,bytes) and owner().
 */
export const PROXY_ADMIN_CODE =
  '0x608060405280639623609d1461001f5780638da5cb5b1461002f57600080fd';

export type ProxyKind =
  | 'transparent'
  | 'uups'
  | 'beacon'
  | 'minimal'
  | 'minimal-push0'
  | 'beacon-contract'
  | 'proxy-admin'
  | 'none';

export interface ProxyFixtureOptions {
  /** Implementation bytecode, so two chains can be given different builds */
  implementationCode?: string;
  /** Native balance of the inspected address */
  balanceWei?: bigint;
  /** OpenZeppelin v5 ERC-7201 initialized version */
  initializedV5?: number;
  /** Packed into slot 0, which is the OpenZeppelin v4 heuristic's only source */
  initializedV4?: number;
  /** owner() on the inspected address; omitted means the call finds nothing */
  proxyOwner?: string;
  /** A transparent proxy whose admin holds no code is reported as an EOA */
  adminIsEoa?: boolean;
  paused?: boolean;
  pendingOwner?: string;
}

/**
 * Chain state for one of the shapes `contract proxy-info` classifies, spread
 * into `startRpcStub`. The address inspected is always `PROXY`.
 */
export function proxyAccounts(
  kind: ProxyKind,
  options: ProxyFixtureOptions = {}
): Pick<RpcStubOptions, 'accounts' | 'receipts'> {
  const {
    implementationCode = IMPLEMENTATION_CODE,
    balanceWei,
    initializedV5,
    initializedV4,
    proxyOwner,
    adminIsEoa = false,
    paused,
    pendingOwner,
  } = options;

  const proxy: AccountFixture = {
    code: PLAIN_CODE,
    storage: {},
    calls: {},
    ...(balanceWei === undefined ? {} : { balanceWei }),
  };
  const accounts: Record<string, AccountFixture> = {
    [PROXY]: proxy,
    [IMPLEMENTATION]: { code: implementationCode },
    [OWNER]: { code: '0x' },
  };
  // The creation transaction every shape has, so --full can date it. The
  // ProxyAdmin shape replaces it with one carrying the AdminChanged event.
  const receipts: Record<string, ReceiptFixture> = { [CREATION_TX]: { blockNumber: 100 } };
  const store = (slot: string, value: string): void => {
    proxy.storage = { ...proxy.storage, [slot]: value };
  };

  switch (kind) {
    case 'transparent':
      store(EIP1967_IMPLEMENTATION_SLOT, slotValue(IMPLEMENTATION));
      store(EIP1967_ADMIN_SLOT, slotValue(ADMIN));
      accounts[ADMIN] = adminIsEoa
        ? { code: '0x' }
        : {
            code: PROXY_ADMIN_CODE,
            calls: {
              'owner()': returns.address(OWNER),
              'UPGRADE_INTERFACE_VERSION()': returns.string('5.0.0'),
            },
          };
      break;

    case 'uups':
      store(EIP1967_IMPLEMENTATION_SLOT, slotValue(IMPLEMENTATION));
      accounts[IMPLEMENTATION] = {
        code: implementationCode,
        calls: { 'proxiableUUID()': returns.bytes32(EIP1967_IMPLEMENTATION_SLOT) },
      };
      break;

    case 'beacon':
      store(EIP1967_BEACON_SLOT, slotValue(BEACON));
      accounts[BEACON] = {
        code: PLAIN_CODE,
        calls: {
          'implementation()': returns.address(IMPLEMENTATION),
          'owner()': returns.address(OWNER),
        },
      };
      break;

    case 'minimal':
    case 'minimal-push0':
      proxy.code = kind === 'minimal' ? clone(IMPLEMENTATION) : clonePush0(IMPLEMENTATION);
      break;

    case 'beacon-contract':
      proxy.calls = { ...proxy.calls, 'implementation()': returns.address(IMPLEMENTATION) };
      break;

    case 'proxy-admin': {
      proxy.code = PROXY_ADMIN_CODE;
      proxy.calls = {
        ...proxy.calls,
        'owner()': returns.address(OWNER),
        'UPGRADE_INTERFACE_VERSION()': returns.string('5.0.0'),
      };
      // OZ v5 deploys the admin from the proxy's constructor, so the admin's
      // creation transaction carries the proxy's AdminChanged event. The trace
      // confirms the candidate by re-reading its own admin slot.
      accounts[MANAGED_PROXY] = {
        code: PLAIN_CODE,
        storage: {
          [EIP1967_ADMIN_SLOT]: slotValue(PROXY),
          [EIP1967_IMPLEMENTATION_SLOT]: slotValue(IMPLEMENTATION),
        },
      };
      receipts[CREATION_TX] = {
        blockNumber: 100,
        logs: [
          { address: MANAGED_PROXY, topics: [ADMIN_CHANGED_TOPIC, ZERO_WORD, slotValue(PROXY)] },
        ],
      };
      break;
    }

    case 'none':
      break;
  }

  if (proxyOwner) {
    proxy.calls = { ...proxy.calls, 'owner()': returns.address(proxyOwner) };
  }
  if (paused !== undefined) {
    proxy.calls = { ...proxy.calls, 'paused()': returns.bool(paused) };
  }
  if (pendingOwner) {
    proxy.calls = { ...proxy.calls, 'pendingOwner()': returns.address(pendingOwner) };
  }
  if (initializedV5 !== undefined) {
    store(INITIALIZABLE_SLOT_V5, slotValue(initializedV5));
  }
  if (initializedV4 !== undefined) {
    store('0x0', slotValue(initializedV4));
  }

  return { accounts, receipts };
}

/** keccak256 of the implementation bytecode, as --full reports it */
export const codeHash = (code: string): string => keccak256(code);

export interface BlackHole {
  url: string;
  port: number;
  /** Resolves once the CLI has connected, so a signal lands mid-request */
  connected: Promise<void>;
}

/**
 * A TCP socket that accepts a connection and never answers, for the paths whose
 * observable behaviour is a timeout or an interruption.
 */
export async function startBlackHole(t: TestLifecycle): Promise<BlackHole> {
  let onConnect = (): void => undefined;
  const connected = new Promise<void>((resolvePromise) => {
    onConnect = resolvePromise;
  });

  // A net.Server has no closeAllConnections, and an unanswered socket would keep
  // server.close() pending for the rest of the run.
  const sockets = new Set<Socket>();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    onConnect();
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = server.address() as AddressInfo;

  t.onTestFinished(
    () =>
      new Promise<void>((resolvePromise) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolvePromise());
      })
  );

  return { url: `http://127.0.0.1:${port}`, port, connected };
}

/** A port nothing listens on, so a connection is refused immediately */
export const REFUSED_URL = 'http://127.0.0.1:1';
