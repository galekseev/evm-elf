/**
 * Result and option types for the CLI commands.
 *
 * Extracted from @deploy-pad/shared, where these lived alongside the deployment
 * engine types. Only the CLI-facing subset is kept, and the engine's
 * ExecutionConfig is replaced by RpcProfile (see src/lib/chains.ts).
 */

import type { ExplorerSettings } from './lib/explorer/types.js';

export type { ExplorerName, ExplorerSettings } from './lib/explorer/types.js';

// ============================================================================
// Chain configuration
// ============================================================================

/**
 * Everything the CLI knows about one chain. chain_id and rpc_url are required
 * to reach the chain; the rest is metadata that cannot be read from an RPC.
 * Both are optional here so that a half-written entry still lists and reports
 * a useful error instead of failing the whole profile.
 */
export interface ChainConfig {
  chain_id?: number;
  rpc_url?: string;
  /** Sent with every RPC request, e.g. { 'auth-key': '${BASE_AUTH_KEY}' } */
  headers?: Record<string, string>;
  /** Native token symbol, shown by wallet balance */
  symbol?: string;
  /** CoinGecko coin id; without it the native token has no USD value */
  coingecko_id?: string;
  /** Etherscan-compatible API for chains outside Etherscan v2 (e.g. zksync Era) */
  explorer_api?: string;
}

/**
 * A profile is the chain configuration: the chains it names are the chains the
 * CLI knows about, so a profile doubles as "the chains this project uses".
 */
export interface RpcProfile {
  /** Profile name (or the path it was loaded from), used in error messages */
  name: string;
  path: string;
  chains: Record<string, ChainConfig>;
  /** Block explorer API keys, one per source; values may hold ${VAR} references */
  explorers: ExplorerSettings;
}

// ============================================================================
// Wallet results
// ============================================================================

export interface BalanceResult {
  chain: string;
  chainId: number;
  address: string;
  balance: string;      // wei as string (for large numbers)
  balanceEth: string;   // formatted with 18 decimals
  nonce: number;        // pending transaction count
  symbol?: string;      // native token symbol
  priceUsd?: number;    // USD per native unit (absent when unpriceable)
  valueUsd?: number;    // balanceEth * priceUsd
  error?: string;
}

export interface SetNonceResult {
  chain: string;
  chainId: number;
  address: string;
  currentNonce: number;
  targetNonce: number;
  txsNeeded: number;
  txsSent?: number;
  finalNonce?: number;
  error?: string;
}

export interface GenerateWalletResult {
  address: string;
  mnemonic: string;
  privateKey: string;
}

export interface CodeResult {
  chain: string;
  chainId: number;
  address: string;
  codeSize: number;     // bytecode size in bytes (0 = no contract)
  deployed: boolean;
  code?: string;        // full bytecode hex (only with --full)
  error?: string;
}

export interface SendResult {
  chain: string;
  chainId: number;
  from: string;
  to: string;
  value: string;        // wei as string
  valueEth: string;     // formatted with 18 decimals
  txHash?: string;      // absent on skip/error
  blockNumber?: number;
  skipped?: string;     // reason the chain was skipped (e.g. balance too low)
  error?: string;
}

// ============================================================================
// Wallet options
// ============================================================================

export interface WalletOptions {
  chain?: string;           // comma-separated chain filter
  excludeChain?: string;    // comma-separated chains to exclude from the default list
  profile?: string;         // name or path of an RPC profile
  json?: boolean;           // output as JSON
}

export interface WalletBalanceOptions extends WalletOptions {
  usd?: boolean;            // value balances in USD (default: true; --no-usd disables)
}

export interface WalletSetNonceOptions extends WalletOptions {
  privateKey: string;       // hex key or env var name
  exec?: boolean;           // send transactions (default: display plan only)
}

export interface WalletGenerateOptions {
  words?: 12 | 24;          // mnemonic length (default: 12)
  json?: boolean;
}

export interface WalletAddressOptions {
  json?: boolean;
}

export interface WalletCodeOptions extends WalletOptions {
  full?: boolean;           // print full bytecode (single chain required)
}

export interface WalletSendOptions extends WalletOptions {
  value?: string;           // amount: "0.01", "0.01ether" or wei string (mutually exclusive with all)
  all?: boolean;            // sweep the entire balance minus gas reserve (mutually exclusive with value)
  feeBuffer?: string;       // gas reserve multiplier for --all (default: 1.1)
  exec?: boolean;           // send transactions (default: display plan only)
  privateKey: string;       // hex key or env var name
  wait?: boolean;           // wait for receipt (default: true)
}

// ============================================================================
// Contract results
// ============================================================================

export interface ContractOwnerResult {
  chain: string;
  chainId: number;
  address: string;
  owner?: string;           // result of owner() call
  error?: string;           // RPC error, no code, or no owner() function
}

// Auto-detected proxy kind
export type ProxyType =
  | 'transparent'      // EIP-1967 implementation + admin slots set
  | 'uups'             // EIP-1967 implementation slot set, no admin
  | 'beacon'           // EIP-1967 beacon slot set
  | 'minimal'          // EIP-1167 / EIP-7511 clone (implementation embedded in bytecode)
  | 'beacon-contract'  // not a proxy: the address itself is a beacon (has implementation())
  | 'proxy-admin'      // not a proxy: the address is an OZ ProxyAdmin (has upgradeAndCall)
  | 'none';            // no proxy markers found

// Account classification for owner addresses (--full)
export interface ProxyAccountInfo {
  kind: 'eoa' | 'safe' | 'contract';
  threshold?: number;       // Safe threshold
  ownersCount?: number;     // Safe owners count
}

// One Upgraded(address) event (--full, requires explorer API)
export interface ProxyUpgradeEvent {
  implementation: string;
  blockNumber: number;
  timestamp?: number;       // unix seconds
}

export interface ProxyInfoResult {
  chain: string;
  chainId: number;
  address: string;
  proxyType?: ProxyType;
  implementation?: string;        // EIP-1967 slot, clone target, or beacon.implementation()
  implementationHasCode?: boolean;
  admin?: string;                 // EIP-1967 admin slot (if non-zero)
  adminHasCode?: boolean;
  adminOwner?: string;            // ProxyAdmin.owner() (when admin is a contract)
  beacon?: string;                // EIP-1967 beacon slot (if non-zero)
  beaconHasCode?: boolean;
  beaconOwner?: string;           // UpgradeableBeacon.owner()
  managedProxy?: string;              // proxy administered by this ProxyAdmin (traced via creation tx)
  managedProxyImplementation?: string;
  proxyOwner?: string;            // owner() called on the proxy itself
  codeSize?: number;                  // bytecode size in bytes (--full)
  upgradeInterfaceVersion?: string;   // ProxyAdmin UPGRADE_INTERFACE_VERSION(), e.g. "5.0.0" (--full)
  erc1822?: boolean;                  // UUPS impl proxiableUUID() matches EIP-1967 slot (--full)
  // --full extras
  initializedVersion?: number;        // Initializable version (0 = not initialized)
  initializersDisabled?: boolean;     // _disableInitializers() was called (uint64 max)
  initializableSource?: 'oz-v5' | 'slot0-heuristic';
  pendingOwner?: string;              // Ownable2Step pending owner (if set)
  paused?: boolean;                   // Pausable state (if the contract has paused())
  balanceWei?: string;                // native balance of the address (if non-zero)
  implementationCodeHash?: string;    // keccak256 of implementation bytecode
  implementationName?: string;        // verified contract name from explorer
  implementationVerified?: boolean;
  upgradeHistory?: ProxyUpgradeEvent[]; // Upgraded events (proxy or beacon)
  createdBy?: string;                 // deployer EOA (from explorer)
  creationTxHash?: string;
  createdAt?: number;                 // creation block timestamp (unix seconds)
  accountInfo?: Record<string, ProxyAccountInfo>; // keyed by lowercase address
  explorerSource?: string;            // explorer that answered first (--json only)
  error?: string;
}

export interface TransferOwnershipResult {
  chain: string;
  chainId: number;
  address: string;
  currentOwner?: string;
  newOwner: string;
  signer: string;
  dryRun: boolean;
  txHash?: string;
  blockNumber?: number;
  finalOwner?: string;      // owner() re-read after execution
  error?: string;
}

export interface UpgradeProxyResult {
  chain: string;
  chainId: number;
  proxy: string;
  proxyAdmin?: string;            // from EIP-1967 admin slot
  adminOwner?: string;            // ProxyAdmin.owner()
  currentImplementation?: string;
  newImplementation: string;
  signer: string;
  dryRun: boolean;
  txHash?: string;
  blockNumber?: number;
  finalImplementation?: string;   // implementation slot re-read after execution
  error?: string;
}

// ============================================================================
// Contract options
// ============================================================================

export interface ContractProxyInfoOptions extends WalletOptions {
  short?: boolean;          // only print chain and detected proxy type
  full?: boolean;           // extra diagnostics (code size, admin version, ERC-1822 check)
}

export interface ContractTransferOwnershipOptions extends WalletOptions {
  privateKey: string;       // hex key or env var name
  exec?: boolean;           // send transaction (default: dry-run only)
}

export interface ContractUpgradeOptions extends WalletOptions {
  privateKey: string;       // hex key or env var name
  data?: string;            // calldata for upgradeAndCall (default: 0x)
  exec?: boolean;           // send transaction (default: dry-run only)
}

// ============================================================================
// Chain configuration options
// ============================================================================

export interface ChainListOptions {
  profile?: string;         // name or path of the profile to read
  reveal?: boolean;         // print header values instead of masking them
  json?: boolean;
}

export interface ChainSetOptions {
  profile?: string;         // name or path of the profile to edit
  chainId?: string;         // skips the eth_chainId lookup
  header?: string[];        // repeatable "<name>:<value>"
  removeHeader?: string[];  // repeatable header name
  symbol?: string;          // empty string clears the field
  coingeckoId?: string;
  explorerApi?: string;
  verify?: boolean;         // --no-verify skips the eth_chainId check
  json?: boolean;
}

export interface ChainRemoveOptions {
  profile?: string;
  json?: boolean;
}

// ============================================================================
// Explorer options
// ============================================================================

export interface ExplorerListOptions {
  profile?: string;         // name or path of the profile to read
  reveal?: boolean;         // print keys instead of masking them
  json?: boolean;
}

export interface ExplorerSetOptions {
  profile?: string;         // name or path of the profile to edit
  verify?: boolean;         // --no-verify skips the key check
  json?: boolean;
}

export interface ExplorerRemoveOptions {
  profile?: string;
  json?: boolean;
}

// ============================================================================
// Profile options
// ============================================================================

export interface ProfileListOptions {
  json?: boolean;
}

export interface ProfileCreateOptions {
  empty?: boolean;          // start from an empty chain list instead of the bundled profile
  json?: boolean;
}

export interface ProfileCloneOptions {
  force?: boolean;          // overwrite the target profile
  json?: boolean;
}

export interface ProfileRemoveOptions {
  force?: boolean;          // remove even when it is the default profile
  json?: boolean;
}

export interface ProfileSetDefaultOptions {
  json?: boolean;
}
