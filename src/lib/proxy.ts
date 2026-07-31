/**
 * EIP-1967 proxy storage slots and minimal ABIs for ownership/proxy commands
 */

import { ZeroAddress, dataSlice, getAddress, zeroPadValue } from 'ethers';
import type { JsonRpcProvider } from 'ethers';

// bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
export const EIP1967_IMPLEMENTATION_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

// bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1)
export const EIP1967_ADMIN_SLOT =
  '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

// bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1)
export const EIP1967_BEACON_SLOT =
  '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';

export const OWNABLE_ABI = [
  'function owner() view returns (address)',
  'function transferOwnership(address newOwner)',
];

// Same upgradeAndCall selector on OZ v4 and v5 ProxyAdmin
export const PROXY_ADMIN_ABI = [
  'function owner() view returns (address)',
  'function upgradeAndCall(address proxy, address implementation, bytes data) payable',
];

// UpgradeableBeacon (OZ) - Ownable with implementation()
export const BEACON_ABI = [
  'function implementation() view returns (address)',
  'function owner() view returns (address)',
];

// OZ v5 ProxyAdmin exposes its interface version ("5.0.0"); absent on v4
export const UPGRADE_INTERFACE_ABI = [
  'function UPGRADE_INTERFACE_VERSION() view returns (string)',
];

// ERC-1822: UUPS implementations return their EIP-1967 implementation slot
export const PROXIABLE_ABI = ['function proxiableUUID() view returns (bytes32)'];

// Ownable2Step
export const OWNABLE2STEP_ABI = ['function pendingOwner() view returns (address)'];

// Pausable
export const PAUSABLE_ABI = ['function paused() view returns (bool)'];

// Gnosis Safe
export const SAFE_ABI = [
  'function getThreshold() view returns (uint256)',
  'function getOwners() view returns (address[])',
];

// OZ v5 Initializable: ERC-7201 namespaced slot for
// keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Initializable")) - 1)) & ~bytes32(uint256(0xff))
// Layout: uint64 _initialized | bool _initializing (packed from the low bytes)
export const INITIALIZABLE_SLOT_V5 =
  '0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00';

// keccak256("Upgraded(address)") - emitted by ERC-1967 proxies and beacons
export const UPGRADED_TOPIC =
  '0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b';

export const UINT64_MAX = 2n ** 64n - 1n;

// EIP-1167 minimal proxy: 363d3d373d3d3d363d73<impl>5af43d82803e903d91602b57fd5bf3
const MINIMAL_PROXY_RE = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/;
// EIP-7511 variant (PUSH0): 365f5f375f5f365f73<impl>5af43d5f5f3e5f3d91602a57fd5bf3
const MINIMAL_PROXY_PUSH0_RE = /^0x365f5f375f5f365f73([0-9a-f]{40})5af43d5f5f3e5f3d91602a57fd5bf3$/;

/**
 * Detect an EIP-1167 / EIP-7511 minimal proxy from its runtime bytecode.
 * Returns the embedded implementation address, or null if not a clone.
 */
export function parseMinimalProxy(code: string): string | null {
  const normalized = code.toLowerCase();
  const match = normalized.match(MINIMAL_PROXY_RE) ?? normalized.match(MINIMAL_PROXY_PUSH0_RE);
  return match ? getAddress(`0x${match[1]}`) : null;
}

// keccak256("AdminChanged(address,address)") - emitted by ERC-1967 proxies
export const ADMIN_CHANGED_TOPIC =
  '0x7e644d79422f17c01e4894b5f4f588d331ebfa28653d42ae832dc59e38c9798f';

// upgradeAndCall(address,address,bytes) - same selector on OZ v4 and v5 ProxyAdmin
const UPGRADE_AND_CALL_SELECTOR = '9623609d';
// owner()
const OWNER_SELECTOR = '8da5cb5b';

/**
 * Heuristic: runtime bytecode contains both the ProxyAdmin upgradeAndCall
 * and Ownable owner() selectors (function dispatcher constants).
 */
export function looksLikeProxyAdmin(code: string): boolean {
  const normalized = code.toLowerCase();
  return normalized.includes(UPGRADE_AND_CALL_SELECTOR) && normalized.includes(OWNER_SELECTOR);
}

/**
 * Read an address stored in a raw storage slot.
 * Returns null when the slot is empty (zero address).
 */
export async function getStorageAddress(
  provider: JsonRpcProvider,
  address: string,
  slot: string
): Promise<string | null> {
  const raw = await provider.getStorage(address, slot);
  const addr = getAddress(dataSlice(zeroPadValue(raw, 32), 12));
  return addr === ZeroAddress ? null : addr;
}

/**
 * Check whether an address has deployed bytecode
 */
export async function hasCode(provider: JsonRpcProvider, address: string): Promise<boolean> {
  const code = await provider.getCode(address);
  return code !== '0x';
}

/**
 * Extract a concise revert reason from an ethers error (falls back to full message)
 */
export function revertReason(err: unknown): string {
  const e = err as { reason?: string; shortMessage?: string; message?: string };
  return e.reason ?? e.shortMessage ?? e.message ?? String(err);
}
