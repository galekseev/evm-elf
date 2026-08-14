/**
 * CREATE / CREATE2 / CREATE3 address derivation, and salt recovery from a
 * creation transaction.
 *
 * Nothing here reads a chain. The caller collects the creation transaction, its
 * receipt and whatever the explorer knows; these functions decide which values
 * reproduce the address. A salt is only ever reported when it does reproduce it,
 * which is what makes scanning the calldata for candidates safe: a 32-byte value
 * that derives the right address is the salt rather than a coincidence.
 */

import {
  AbiCoder,
  concat,
  dataLength,
  dataSlice,
  getAddress,
  getCreate2Address,
  getCreateAddress,
  id,
  keccak256,
  toBeHex,
  zeroPadValue,
} from 'ethers';
import type { DeploymentMethod } from '../types.js';

// ============================================================================
// CREATE3 proxies
// ============================================================================

export interface Create3ProxyKind {
  /** Named in the report, next to the proxy address */
  label: string;
  initCode: string;
  initCodeHash: string;
  /** The proxy destroys itself after the CREATE, leaving no code behind */
  selfDestructs: boolean;
  /** Runtime code the proxy leaves at its address, when it survives */
  runtime: string;
}

/**
 * Both CREATE3 proxy shapes in use. The runtime copies the calldata and CREATEs
 * it; the second one then destroys itself, and since that happens in the same
 * transaction as its creation, EIP-6780 does not preserve it.
 */
export const CREATE3_PROXIES: Create3ProxyKind[] = [
  {
    label: 'canonical (Solady, solmate, CreateX)',
    initCode: '0x67363d3d37363d34f03d5260086018f3',
    initCodeHash: keccak256('0x67363d3d37363d34f03d5260086018f3'),
    selfDestructs: false,
    runtime: '0x363d3d37363d34f0',
  },
  {
    label: 'self-destructing (1inch legacy)',
    initCode: '0x68363d3d37363d34f0ff3d5260096017f3',
    initCodeHash: keccak256('0x68363d3d37363d34f0ff3d5260096017f3'),
    selfDestructs: true,
    runtime: '0x363d3d37363d34f0ff',
  },
];

/** Identify a CREATE3 proxy that is still deployed, from its runtime bytecode */
export function create3ProxyFromRuntime(code: string): Create3ProxyKind | undefined {
  const normalized = code.toLowerCase();
  return CREATE3_PROXIES.find((kind) => kind.runtime === normalized);
}

// ============================================================================
// Factories
// ============================================================================

/**
 * Names for factories deployed at a fixed address. This only labels output:
 * factories are recognised by the shape of the call and by what reproduces the
 * address, so one deployed at an address nobody has catalogued still resolves.
 */
const FACTORY_NAMES: Record<string, string> = {
  '0x4e59b44847b379578588920ca78fbf26c0b4956c': 'Arachnid deterministic deployment proxy',
  '0x914d7fec6aac8cd542e72bca78b30650d45643d7': 'Safe Singleton Factory',
  '0x13b0d85ccb8bf860b6b79af3029fca081ae9bef2': 'Create2Deployer',
  '0x0000000000ffe8b47b3e2130213b802212439497': 'ImmutableCreate2Factory',
  '0xba5ed099633d3b313e4d5f7bdc1305d3c28ba5ed': 'CreateX',
  '0x65b3db8baef0215a1f9b14c506d2a3078b2c84ae': '1inch Create3Deployer (legacy)',
};

export function factoryName(address: string): string | undefined {
  return FACTORY_NAMES[address.toLowerCase()];
}

/** addressOf() on a 1inch-style CREATE3 deployer: its own view of a salt's address */
export const CREATE3_DEPLOYER_ABI = ['function addressOf(bytes32 salt) view returns (address)'];

// ============================================================================
// Factory call decoding
// ============================================================================

interface SelectorSpec {
  signature: string;
  /** Argument types, for decoding the call */
  params: string[];
  saltIndex?: number;
  /** Index of the init code argument, when the call carries one */
  codeIndex?: number;
  /** What the signature implies, used only when nothing reproduces the address */
  method?: DeploymentMethod;
}

const SIGNATURES: SelectorSpec[] = [
  // 1inch Create3Deployer, ZeframLou and Solady-style CREATE3 factories. Also
  // used by some CREATE2 factories, so it carries no method hint.
  { signature: 'deploy(bytes32,bytes)', params: ['bytes32', 'bytes'], saltIndex: 0, codeIndex: 1 },
  {
    signature: 'safeCreate2(bytes32,bytes)',
    params: ['bytes32', 'bytes'],
    saltIndex: 0,
    codeIndex: 1,
    method: 'create2',
  },
  {
    signature: 'deploy(uint256,bytes32,bytes)',
    params: ['uint256', 'bytes32', 'bytes'],
    saltIndex: 1,
    codeIndex: 2,
    method: 'create2',
  },
  {
    signature: 'deployCreate2(bytes32,bytes)',
    params: ['bytes32', 'bytes'],
    saltIndex: 0,
    codeIndex: 1,
    method: 'create2',
  },
  {
    signature: 'deployCreate2AndInit(bytes32,bytes,bytes,(uint256,uint256))',
    params: ['bytes32', 'bytes', 'bytes', '(uint256,uint256)'],
    saltIndex: 0,
    codeIndex: 1,
    method: 'create2',
  },
  {
    signature: 'deployCreate2AndInit(bytes32,bytes,bytes,(uint256,uint256),address)',
    params: ['bytes32', 'bytes', 'bytes', '(uint256,uint256)', 'address'],
    saltIndex: 0,
    codeIndex: 1,
    method: 'create2',
  },
  {
    signature: 'deployCreate2Clone(bytes32,address,bytes)',
    params: ['bytes32', 'address', 'bytes'],
    saltIndex: 0,
    method: 'create2',
  },
  {
    signature: 'deployCreate3(bytes32,bytes)',
    params: ['bytes32', 'bytes'],
    saltIndex: 0,
    codeIndex: 1,
    method: 'create3',
  },
  {
    signature: 'deployCreate3AndInit(bytes32,bytes,bytes,(uint256,uint256))',
    params: ['bytes32', 'bytes', 'bytes', '(uint256,uint256)'],
    saltIndex: 0,
    codeIndex: 1,
    method: 'create3',
  },
  {
    signature: 'deployCreate3AndInit(bytes32,bytes,bytes,(uint256,uint256),address)',
    params: ['bytes32', 'bytes', 'bytes', '(uint256,uint256)', 'address'],
    saltIndex: 0,
    codeIndex: 1,
    method: 'create3',
  },
  // Salt-less CreateX overloads: the salt is generated on chain and only appears
  // in the event, so they contribute a method hint and nothing else.
  { signature: 'deployCreate2(bytes)', params: ['bytes'], codeIndex: 0, method: 'create2' },
  { signature: 'deployCreate3(bytes)', params: ['bytes'], codeIndex: 0, method: 'create3' },
  { signature: 'deployCreate(bytes)', params: ['bytes'], codeIndex: 0, method: 'create' },
];

const SELECTORS = new Map(SIGNATURES.map((spec) => [id(spec.signature).slice(0, 10), spec]));

export interface FactoryCall {
  signature: string;
  /** Salt the call carries. Absent for the salt-less overloads. */
  salt?: string;
  initCode?: string;
  method?: DeploymentMethod;
}

/**
 * Decode a call to a factory whose signature is known. Returns undefined for
 * anything else, including the bare `salt ++ initCode` calldata that Arachnid's
 * proxy takes, which has no selector to match and is handled by the candidate
 * scan instead.
 */
export function decodeFactoryCall(calldata: string): FactoryCall | undefined {
  if (dataLength(calldata) < 4) {
    return undefined;
  }
  const spec = SELECTORS.get(dataSlice(calldata, 0, 4).toLowerCase());
  if (!spec) {
    return undefined;
  }
  try {
    const args = AbiCoder.defaultAbiCoder().decode(spec.params, dataSlice(calldata, 4));
    return {
      signature: spec.signature,
      ...(spec.method ? { method: spec.method } : {}),
      ...(spec.saltIndex !== undefined ? { salt: args[spec.saltIndex] as string } : {}),
      ...(spec.codeIndex !== undefined ? { initCode: args[spec.codeIndex] as string } : {}),
    };
  } catch {
    // Calldata that starts with a known selector but does not decode: the
    // signature is a collision, so nothing can be read from it.
    return undefined;
  }
}

// ============================================================================
// Salt recovery
// ============================================================================

/**
 * Words of calldata searched when the layout is unknown. A factory's ABI puts
 * every 32-byte argument in the head of the encoding, ahead of the init code,
 * so a salt that is not in the first few kilobytes is not one an ABI produced.
 */
const SALT_SCAN_WORDS = 128;

/** Field names match DeterministicMatch, so a variant can be spread into it */
interface SaltVariant {
  guardedSalt?: string;
  guardLabel?: string;
}

/**
 * The hashed salts a factory may derive from the one it was handed. CreateX
 * guards a salt before using it, choosing among the first four by the salt's own
 * 21st byte; ZeframLou-style factories namespace it by the caller. Trying all of
 * them costs a few hashes and removes the need to know which factory this is.
 */
function guardedVariants(salt: string, sender: string, chainId: number): SaltVariant[] {
  const senderWord = zeroPadValue(sender, 32);
  return [
    {
      guardedSalt: keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'bytes32'],
          [sender, chainId, salt]
        )
      ),
      guardLabel: 'keccak256(sender, chainId, salt) - permissioned + cross-chain redeploy protection',
    },
    {
      guardedSalt: keccak256(concat([senderWord, salt])),
      guardLabel: 'keccak256(sender, salt) - permissioned deploy protection',
    },
    {
      guardedSalt: keccak256(concat([toBeHex(chainId, 32), salt])),
      guardLabel: 'keccak256(chainId, salt) - cross-chain redeploy protection',
    },
    {
      guardedSalt: keccak256(salt),
      guardLabel: 'keccak256(salt) - no protection flags set',
    },
    {
      guardedSalt: keccak256(concat([sender, salt])),
      guardLabel: 'keccak256(sender ++ salt) - caller-namespaced salt',
    },
  ];
}

function words(calldata: string, from: number, limit: number): string[] {
  const total = dataLength(calldata);
  const found: string[] = [];
  for (let offset = from; offset + 32 <= total && found.length < limit; offset += 32) {
    found.push(dataSlice(calldata, offset, offset + 32));
  }
  return found;
}

/**
 * Every 32-byte value worth testing, best guess first: what the signature says,
 * then the head of the calldata under both layouts, then anything a log carried,
 * then a scan.
 */
function candidateSalts(calldata: string, call: FactoryCall | undefined, topics: string[]): string[] {
  const ordered = [
    ...(call?.salt ? [call.salt] : []),
    ...words(calldata, 0, 1),
    ...words(calldata, 4, 1),
    ...topics,
    ...words(calldata, 4, SALT_SCAN_WORDS),
    ...words(calldata, 0, SALT_SCAN_WORDS),
  ];
  return [...new Set(ordered.map((word) => word.toLowerCase()))];
}

export interface RecoverInput {
  /** The contract whose deployment is being explained */
  address: string;
  chainId: number;
  /**
   * Addresses to test as the factory's caller, which the guarded-salt rules hash
   * in. That is the transaction sender for a direct call, and the intermediate
   * contract when the call went through a Safe or a router.
   */
  senders: string[];
  /** Addresses to test as the CREATE2 deployer, best candidate first */
  deployers: string[];
  calldata: string;
  /** Topics of the creation receipt's logs; a factory often logs its salt */
  logTopics?: string[];
  /** Init codes to test, from the explorer and from the decoded call */
  initCodes?: string[];
}

export interface DeterministicMatch {
  method: 'create2' | 'create3';
  deployer: string;
  /** Salt as submitted to the factory */
  salt: string;
  /** Value the factory derived from it and actually used, when it differs */
  guardedSalt?: string;
  guardLabel?: string;
  /** CREATE2 only: the init code hash that reproduced the address */
  initCodeHash?: string;
  /** CREATE3 only */
  proxy?: string;
  proxyKind?: Create3ProxyKind;
}

/**
 * Canonical form of an address, taking the case as meaningless. Addresses reach
 * here from explorers as well as from ethers, and one that arrives mixed-case
 * with a stale checksum should not cost the whole chain its answer.
 */
export function checksumAddress(address: string): string {
  return getAddress(address.toLowerCase());
}

/**
 * Find the salt that reproduces the address, and with it the method. Returns
 * null when nothing does, which is the honest answer for a factory that mixes
 * the salt with something we cannot see.
 */
export function recoverDeployment(input: RecoverInput): DeterministicMatch | null {
  const target = checksumAddress(input.address);
  const call = decodeFactoryCall(input.calldata);
  const salts = candidateSalts(input.calldata, call, input.logTopics ?? []);
  const initCodeHashes = [
    ...new Set(
      [...(input.initCodes ?? []), ...(call?.initCode ? [call.initCode] : [])]
        .filter((code) => code && code !== '0x')
        .map((code) => keccak256(code))
    ),
  ];
  const deployers = [...new Set(input.deployers.map(checksumAddress))];
  const senders = [...new Set(input.senders.map(checksumAddress))];

  for (const salt of salts) {
    const variants: SaltVariant[] = [
      {},
      ...senders.flatMap((sender) => guardedVariants(salt, sender, input.chainId)),
    ];
    for (const variant of variants) {
      const effective = variant.guardedSalt ?? salt;
      for (const deployer of deployers) {
        for (const initCodeHash of initCodeHashes) {
          if (getCreate2Address(deployer, effective, initCodeHash) === target) {
            return { method: 'create2', deployer, salt, ...variant, initCodeHash };
          }
        }
        for (const proxyKind of CREATE3_PROXIES) {
          const proxy = getCreate2Address(deployer, effective, proxyKind.initCodeHash);
          if (getCreateAddress({ from: proxy, nonce: 1 }) === target) {
            return { method: 'create3', deployer, salt, ...variant, proxy, proxyKind };
          }
        }
      }
    }
  }
  return null;
}

/** Whether an address is the one `from` would create at `nonce` */
export function matchesCreate(address: string, from: string, nonce: number): boolean {
  return getCreateAddress({ from: checksumAddress(from), nonce }) === checksumAddress(address);
}

/**
 * Contracts a factory can have created before the search gives up. Each step is
 * one hash, so the ceiling is about the pointlessness of the answer rather than
 * the cost: a factory with more creations than this is not one whose nonces
 * anybody is reading off a report.
 */
const CREATE_NONCE_LIMIT = 50_000;

/**
 * The nonce at which a contract created `address`, when it is one of its first
 * `CREATE_NONCE_LIMIT`. A contract's nonce counts the contracts it has created,
 * so the current count bounds the search, and finding the nonce turns "created
 * by a contract" from an inference into a reproducible fact.
 */
export function findCreateNonce(
  address: string,
  from: string,
  currentNonce: number
): number | undefined {
  const creator = checksumAddress(from);
  const target = checksumAddress(address);
  const highest = Math.min(currentNonce, CREATE_NONCE_LIMIT);
  for (let nonce = 1; nonce <= highest; nonce += 1) {
    if (getCreateAddress({ from: creator, nonce }) === target) {
      return nonce;
    }
  }
  return undefined;
}

/** The method a factory's signature implies, for when no salt reproduced the address */
export function hintedMethod(calldata: string): DeploymentMethod | undefined {
  return decodeFactoryCall(calldata)?.method;
}
