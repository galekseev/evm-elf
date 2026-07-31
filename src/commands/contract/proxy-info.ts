/**
 * contract proxy-info command - inspect a proxy across chains
 * Auto-detects the proxy type (transparent, UUPS, beacon, minimal clone)
 * and prints the information relevant for each type.
 */

import chalk from 'chalk';
import { Contract, ZeroAddress, formatEther, isAddress, keccak256 } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import type {
  ContractProxyInfoOptions,
  ProxyAccountInfo,
  ProxyInfoResult,
} from '../../types.js';
import { loadEnv } from '../../lib/env.js';
import {
  loadProfile,
  resolveChain,
  selectChains,
  type ResolvedChain,
} from '../../lib/chains.js';
import { createProvider } from '../../lib/rpc.js';
import {
  ADMIN_CHANGED_TOPIC,
  BEACON_ABI,
  EIP1967_ADMIN_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  INITIALIZABLE_SLOT_V5,
  OWNABLE2STEP_ABI,
  OWNABLE_ABI,
  PAUSABLE_ABI,
  PROXIABLE_ABI,
  SAFE_ABI,
  UINT64_MAX,
  UPGRADED_TOPIC,
  UPGRADE_INTERFACE_ABI,
  getStorageAddress,
  hasCode,
  looksLikeProxyAdmin,
  parseMinimalProxy,
} from '../../lib/proxy.js';
import {
  getContractCreation,
  getContractInfo,
  getLogsByTopic,
  type ExplorerTarget,
} from '../../lib/explorer.js';

async function tryOwner(provider: JsonRpcProvider, address: string): Promise<string | undefined> {
  try {
    const contract = new Contract(address, OWNABLE_ABI, provider);
    return (await contract.owner()) as string;
  } catch {
    return undefined;
  }
}

async function tryUpgradeInterfaceVersion(
  provider: JsonRpcProvider,
  address: string
): Promise<string | undefined> {
  try {
    const contract = new Contract(address, UPGRADE_INTERFACE_ABI, provider);
    return (await contract.UPGRADE_INTERFACE_VERSION()) as string;
  } catch {
    return undefined;
  }
}

/**
 * ERC-1822 check: a UUPS implementation must return the EIP-1967
 * implementation slot from proxiableUUID().
 */
async function checkErc1822(
  provider: JsonRpcProvider,
  implementation: string
): Promise<boolean | undefined> {
  try {
    const contract = new Contract(implementation, PROXIABLE_ABI, provider);
    const uuid = (await contract.proxiableUUID()) as string;
    return uuid.toLowerCase() === EIP1967_IMPLEMENTATION_SLOT;
  } catch {
    return undefined;
  }
}

/**
 * Find the transparent proxy administered by a ProxyAdmin.
 * OZ v5 deploys the ProxyAdmin from the proxy's constructor, so the creation
 * transaction contains an AdminChanged event emitted by the proxy. The
 * candidate is verified by re-reading its EIP-1967 admin slot.
 */
async function findManagedProxy(
  provider: JsonRpcProvider,
  explorer: ExplorerTarget,
  adminAddress: string
): Promise<{ proxy: string; implementation?: string } | null> {
  const creation = await getContractCreation(explorer, adminAddress);
  if (!creation) {
    return null;
  }

  const receipt = await provider.getTransactionReceipt(creation.txHash);
  if (!receipt) {
    return null;
  }

  for (const log of receipt.logs) {
    if (log.topics[0]?.toLowerCase() !== ADMIN_CHANGED_TOPIC) {
      continue;
    }
    const candidate = log.address;
    const admin = await getStorageAddress(provider, candidate, EIP1967_ADMIN_SLOT);
    if (admin?.toLowerCase() === adminAddress.toLowerCase()) {
      const implementation = await getStorageAddress(
        provider,
        candidate,
        EIP1967_IMPLEMENTATION_SLOT
      );
      return { proxy: candidate, implementation: implementation ?? undefined };
    }
  }
  return null;
}

/**
 * Classify an address: EOA, Gnosis Safe (with threshold/owners), or other contract
 */
async function describeAccount(
  provider: JsonRpcProvider,
  address: string
): Promise<ProxyAccountInfo> {
  if (!(await hasCode(provider, address))) {
    return { kind: 'eoa' };
  }
  try {
    const safe = new Contract(address, SAFE_ABI, provider);
    const [threshold, owners] = await Promise.all([safe.getThreshold(), safe.getOwners()]);
    return { kind: 'safe', threshold: Number(threshold), ownersCount: (owners as string[]).length };
  } catch {
    return { kind: 'contract' };
  }
}

/**
 * Read the Initializable state. Tries the OZ v5 ERC-7201 namespaced slot
 * first; falls back to the OZ v4 layout (packed into slot 0, heuristic).
 */
async function readInitialized(
  provider: JsonRpcProvider,
  address: string
): Promise<Pick<ProxyInfoResult, 'initializedVersion' | 'initializersDisabled' | 'initializableSource'>> {
  const rawV5 = await provider.getStorage(address, INITIALIZABLE_SLOT_V5);
  const v5 = BigInt(rawV5) & UINT64_MAX;
  if (v5 > 0n) {
    return v5 === UINT64_MAX
      ? { initializersDisabled: true, initializableSource: 'oz-v5' }
      : { initializedVersion: Number(v5), initializableSource: 'oz-v5' };
  }
  // OZ v4: uint8 _initialized packed into the low byte of slot 0 (heuristic -
  // slot 0 may hold unrelated data, so only plausible versions are accepted)
  const raw0 = await provider.getStorage(address, 0);
  const v4 = BigInt(raw0) & 0xffn;
  if (v4 === 0xffn) {
    return { initializersDisabled: true, initializableSource: 'slot0-heuristic' };
  }
  if (v4 > 0n && v4 <= 10n) {
    return { initializedVersion: Number(v4), initializableSource: 'slot0-heuristic' };
  }
  if (v4 > 10n) {
    // slot 0 holds something else - initialization state is indeterminate
    return {};
  }
  return { initializedVersion: 0 };
}

const PROXY_TYPES_WITH_STATE = new Set(['transparent', 'uups', 'beacon', 'minimal']);

/**
 * Full-mode enrichment: balance, initialization state, pending owner, paused,
 * implementation codehash/name, upgrade history, creation info, and owner
 * account classification. All lookups are best-effort.
 */
async function enrichFull(
  provider: JsonRpcProvider,
  explorer: ExplorerTarget,
  result: ProxyInfoResult
): Promise<void> {
  const type = result.proxyType ?? 'none';
  const isProxy = PROXY_TYPES_WITH_STATE.has(type);

  // Native balance (flagged only when non-zero)
  const balance = await provider.getBalance(result.address);
  if (balance > 0n) {
    result.balanceWei = balance.toString();
  }

  if (isProxy) {
    Object.assign(result, await readInitialized(provider, result.address));

    // Ownable2Step pending owner (through the proxy)
    try {
      const contract = new Contract(result.address, OWNABLE2STEP_ABI, provider);
      const pending = (await contract.pendingOwner()) as string;
      if (pending !== ZeroAddress) {
        result.pendingOwner = pending;
      }
    } catch {
      // not Ownable2Step
    }

    // Pausable state (through the proxy)
    try {
      const contract = new Contract(result.address, PAUSABLE_ABI, provider);
      result.paused = (await contract.paused()) as boolean;
    } catch {
      // not Pausable
    }
  }

  // Implementation codehash + verified name
  if (result.implementation && result.implementationHasCode) {
    const implCode = await provider.getCode(result.implementation);
    result.implementationCodeHash = keccak256(implCode);
    const info = await getContractInfo(explorer, result.implementation);
    if (info) {
      result.implementationName = info.name;
      result.implementationVerified = info.verified;
    }
  }

  // Upgrade history: Upgraded events live on the proxy (transparent/UUPS) or the beacon
  const upgradeSource =
    type === 'beacon' ? result.beacon : type === 'beacon-contract' ? result.address : isProxy ? result.address : undefined;
  if (upgradeSource && type !== 'minimal') {
    const logs = await getLogsByTopic(explorer, upgradeSource, UPGRADED_TOPIC);
    if (logs) {
      result.upgradeHistory = logs
        .filter((log) => log.topics.length > 1)
        .map((log) => ({
          implementation: `0x${log.topics[1].slice(26)}`,
          blockNumber: log.blockNumber,
          timestamp: log.timestamp,
        }));
    }
  }

  // Creation info (deployer, tx, date)
  const creation = await getContractCreation(explorer, result.address);
  if (creation) {
    result.createdBy = creation.creator;
    result.creationTxHash = creation.txHash;
    try {
      const receipt = await provider.getTransactionReceipt(creation.txHash);
      if (receipt) {
        const block = await provider.getBlock(receipt.blockNumber);
        result.createdAt = block?.timestamp;
      }
    } catch {
      // date unavailable
    }
  }

  // Classify owner accounts (EOA / Safe / contract)
  const ownerAddresses = new Set(
    [result.adminOwner, result.proxyOwner, result.beaconOwner]
      .filter((a): a is string => !!a)
      .map((a) => a.toLowerCase())
  );
  if (ownerAddresses.size > 0) {
    result.accountInfo = {};
    for (const owner of ownerAddresses) {
      result.accountInfo[owner] = await describeAccount(provider, owner);
    }
  }
}

type InspectMode = 'short' | 'normal' | 'full';

/**
 * Inspect an address. In 'short' mode only the proxy type is detected;
 * owner lookups, code checks of related addresses, and the managed proxy
 * trace are skipped. 'full' adds extra diagnostics (code size, ProxyAdmin
 * version, ERC-1822 check for UUPS).
 */
async function inspectProxy(
  provider: JsonRpcProvider,
  resolved: ResolvedChain,
  address: string,
  mode: InspectMode
): Promise<ProxyInfoResult> {
  const result: ProxyInfoResult = { chain: resolved.chain, chainId: resolved.chainId, address };
  const explorer: ExplorerTarget = {
    chainId: resolved.chainId,
    ...(resolved.explorerApi ? { apiUrl: resolved.explorerApi } : {}),
  };
  const light = mode === 'short';
  const full = mode === 'full';

  const code = await provider.getCode(address);
  if (code === '0x') {
    result.error = 'no code at address';
    return result;
  }
  if (full) {
    result.codeSize = (code.length - 2) / 2;
  }

  // Minimal clone: implementation is embedded in the bytecode, no storage slots
  const cloneTarget = parseMinimalProxy(code);
  if (cloneTarget) {
    result.proxyType = 'minimal';
    result.implementation = cloneTarget;
    if (!light) {
      result.implementationHasCode = await hasCode(provider, cloneTarget);
      result.proxyOwner = await tryOwner(provider, address);
    }
    if (full) {
      await enrichFull(provider, explorer, result);
    }
    return result;
  }

  const [implementation, admin, beacon] = await Promise.all([
    getStorageAddress(provider, address, EIP1967_IMPLEMENTATION_SLOT),
    getStorageAddress(provider, address, EIP1967_ADMIN_SLOT),
    getStorageAddress(provider, address, EIP1967_BEACON_SLOT),
  ]);

  if (admin) {
    result.admin = admin;
    if (!light) {
      result.adminHasCode = await hasCode(provider, admin);
      if (result.adminHasCode) {
        result.adminOwner = await tryOwner(provider, admin);
      }
    }
  }

  if (implementation) {
    result.implementation = implementation;
    if (!light) {
      result.implementationHasCode = await hasCode(provider, implementation);
    }
  }

  if (beacon) {
    result.proxyType = 'beacon';
    result.beacon = beacon;
    if (!light) {
      result.beaconHasCode = await hasCode(provider, beacon);
      if (result.beaconHasCode) {
        const beaconContract = new Contract(beacon, BEACON_ABI, provider);
        try {
          result.implementation = (await beaconContract.implementation()) as string;
          result.implementationHasCode = await hasCode(provider, result.implementation);
        } catch {
          // beacon without implementation() - leave unset
        }
        result.beaconOwner = await tryOwner(provider, beacon);
      }
    }
  } else if (implementation && admin) {
    result.proxyType = 'transparent';
    if (full && result.adminHasCode) {
      result.upgradeInterfaceVersion = await tryUpgradeInterfaceVersion(provider, admin);
    }
  } else if (implementation) {
    result.proxyType = 'uups';
    if (full) {
      result.erc1822 = await checkErc1822(provider, implementation);
    }
  } else if (looksLikeProxyAdmin(code)) {
    result.proxyType = 'proxy-admin';
    if (full) {
      result.upgradeInterfaceVersion = await tryUpgradeInterfaceVersion(provider, address);
    }
    if (!light) {
      const managed = await findManagedProxy(provider, explorer, address);
      if (managed) {
        result.managedProxy = managed.proxy;
        result.managedProxyImplementation = managed.implementation;
      }
    }
  } else {
    result.proxyType = 'none';
    // The address may itself be a beacon (UpgradeableBeacon exposes implementation())
    try {
      const beaconContract = new Contract(address, BEACON_ABI, provider);
      const beaconImpl = (await beaconContract.implementation()) as string;
      if (isAddress(beaconImpl)) {
        result.proxyType = 'beacon-contract';
        result.implementation = beaconImpl;
        if (!light) {
          result.implementationHasCode = await hasCode(provider, beaconImpl);
        }
      }
    } catch {
      // not a beacon either
    }
  }

  if (!light) {
    result.proxyOwner = await tryOwner(provider, address);
  }
  if (full) {
    await enrichFull(provider, explorer, result);
  }
  return result;
}

const SHORT_TYPE_LABELS: Record<string, string> = {
  transparent: 'transparent proxy',
  uups: 'UUPS proxy',
  beacon: 'beacon proxy',
  minimal: 'minimal clone',
  'beacon-contract': 'beacon contract',
  'proxy-admin': 'ProxyAdmin',
  none: 'not a proxy',
};

const PROXY_TYPE_LABELS: Record<string, string> = {
  transparent: 'Transparent proxy (EIP-1967)',
  uups: 'UUPS / ERC-1967 proxy (no admin slot)',
  beacon: 'Beacon proxy (EIP-1967)',
  minimal: 'Minimal proxy (EIP-1167 clone)',
  'beacon-contract': 'Beacon contract (not a proxy; proxies point here)',
  'proxy-admin': 'ProxyAdmin contract (not a proxy; administers a transparent proxy)',
  none: 'Not a proxy (no EIP-1967 slots, not a clone)',
};

function printUpgradeVersion(
  result: ProxyInfoResult,
  line: (label: string, value: string) => void
): void {
  line(
    'Admin version:',
    result.upgradeInterfaceVersion
      ? chalk.cyan(result.upgradeInterfaceVersion) + chalk.dim(' (OZ v5+)')
      : chalk.dim('no UPGRADE_INTERFACE_VERSION() (likely OZ v4)')
  );
}

function formatDate(unixSeconds: number | undefined): string | undefined {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString().slice(0, 10) : undefined;
}

function printFullExtras(
  result: ProxyInfoResult,
  line: (label: string, value: string) => void
): void {
  if (result.initializedVersion !== undefined || result.initializersDisabled) {
    const heuristic = result.initializableSource === 'slot0-heuristic' ? chalk.dim(' (OZ v4 layout, heuristic)') : '';
    if (result.initializersDisabled) {
      line('Initialized:', chalk.dim('initializers disabled (_disableInitializers)') + heuristic);
    } else if (result.initializedVersion === 0) {
      line('Initialized:', chalk.red('NOT initialized - initialize() is callable by anyone!') + chalk.dim(' (or does not use Initializable)'));
    } else {
      line('Initialized:', chalk.green(`yes (version ${result.initializedVersion})`) + heuristic);
    }
  }

  if (result.pendingOwner) {
    line('Pending owner:', chalk.yellow(result.pendingOwner) + chalk.dim(' (Ownable2Step transfer awaiting acceptOwnership)'));
  }

  if (result.paused !== undefined) {
    line('Paused:', result.paused ? chalk.red('YES') : chalk.dim('no'));
  }

  if (result.balanceWei) {
    line('Balance:', chalk.yellow(`${formatEther(BigInt(result.balanceWei))} ETH`) + chalk.dim(' (native funds held by this address)'));
  }

  if (result.implementation && result.implementationVerified !== undefined) {
    line(
      'Impl contract:',
      result.implementationVerified
        ? chalk.cyan(result.implementationName ?? 'unknown') + chalk.dim(' (verified)')
        : chalk.yellow('source not verified')
    );
  }
  if (result.implementationCodeHash) {
    line('Impl codehash:', chalk.dim(result.implementationCodeHash));
  }

  if (result.upgradeHistory) {
    if (result.upgradeHistory.length === 0) {
      line('Upgrades:', chalk.dim('none recorded'));
    } else {
      const last = result.upgradeHistory[result.upgradeHistory.length - 1];
      const when = formatDate(last.timestamp);
      line(
        'Upgrades:',
        `${result.upgradeHistory.length}` +
          chalk.dim(` (last -> ${last.implementation}${when ? ` on ${when}` : ''})`)
      );
    }
  }

  if (result.createdBy) {
    const when = formatDate(result.createdAt);
    line('Created by:', chalk.cyan(result.createdBy));
    if (when) {
      line('Created on:', chalk.dim(when));
    }
    line('Creation tx:', chalk.dim(result.creationTxHash ?? 'n/a'));
  }
}

function printResult(result: ProxyInfoResult, full: boolean): void {
  const na = chalk.dim('n/a');
  const addr = (value: string | undefined): string => (value ? chalk.cyan(value) : na);
  const codeTag = (has: boolean | undefined): string =>
    has === undefined ? '' : has ? chalk.dim(' (contract)') : chalk.yellow(' (no code!)');
  const line = (label: string, value: string): void =>
    console.log(`  ${label.padEnd(15)} ${value}`);
  const acct = (address: string | undefined): string => {
    if (!address || !result.accountInfo) return '';
    const info = result.accountInfo[address.toLowerCase()];
    if (!info) return '';
    if (info.kind === 'safe') return chalk.dim(` (Safe ${info.threshold}/${info.ownersCount})`);
    if (info.kind === 'contract') return chalk.dim(' (contract)');
    return chalk.dim(' (EOA)');
  };

  console.log();
  console.log(`${chalk.bold(result.chain)} (chain ID ${result.chainId})`);

  if (result.error) {
    console.log(`  ${chalk.red(result.error)}`);
    return;
  }

  const type = result.proxyType ?? 'none';
  line('Type:', type === 'none' ? chalk.yellow(PROXY_TYPE_LABELS[type]) : chalk.bold(PROXY_TYPE_LABELS[type]));

  if (result.codeSize !== undefined) {
    line('Code size:', chalk.dim(`${result.codeSize} B`));
  }

  switch (type) {
    case 'transparent':
      line('Implementation:', addr(result.implementation) + codeTag(result.implementationHasCode));
      line(
        'Proxy admin:',
        addr(result.admin) +
          (result.adminHasCode === undefined
            ? ''
            : result.adminHasCode
              ? chalk.dim(' (ProxyAdmin contract)')
              : chalk.yellow(' (EOA - upgrades sent directly by this account)'))
      );
      if (full && result.adminHasCode) {
        printUpgradeVersion(result, line);
      }
      line('Admin owner:', addr(result.adminOwner) + acct(result.adminOwner));
      line('Proxy owner():', addr(result.proxyOwner) + acct(result.proxyOwner));
      break;

    case 'uups':
      line('Implementation:', addr(result.implementation) + codeTag(result.implementationHasCode));
      if (full) {
        line(
          'ERC-1822:',
          result.erc1822 === undefined
            ? chalk.dim('no proxiableUUID() on implementation (not verifiable)')
            : result.erc1822
              ? chalk.green('confirmed (proxiableUUID matches EIP-1967 slot)')
              : chalk.red('MISMATCH - proxiableUUID does not match EIP-1967 slot')
        );
      }
      line('Proxy owner():', addr(result.proxyOwner) + acct(result.proxyOwner) + chalk.dim(' (usually authorizes upgrades)'));
      break;

    case 'beacon':
      line('Beacon:', addr(result.beacon) + codeTag(result.beaconHasCode));
      line('Beacon owner:', addr(result.beaconOwner) + acct(result.beaconOwner) + chalk.dim(' (controls upgrades for all proxies of this beacon)'));
      line(
        'Implementation:',
        addr(result.implementation) +
          codeTag(result.implementationHasCode) +
          (result.implementation ? chalk.dim(' (via beacon.implementation())') : '')
      );
      line('Proxy owner():', addr(result.proxyOwner));
      break;

    case 'minimal':
      line('Implementation:', addr(result.implementation) + codeTag(result.implementationHasCode) + chalk.dim(' (embedded in bytecode, NOT upgradeable)'));
      line('Proxy owner():', addr(result.proxyOwner) + acct(result.proxyOwner));
      break;

    case 'beacon-contract':
      line('Implementation:', addr(result.implementation) + codeTag(result.implementationHasCode) + chalk.dim(' (via implementation())'));
      line('Owner():', addr(result.proxyOwner) + acct(result.proxyOwner) + chalk.dim(' (controls upgrades for all proxies of this beacon)'));
      break;

    case 'proxy-admin':
      if (full) {
        printUpgradeVersion(result, line);
      }
      line('Owner():', addr(result.proxyOwner) + acct(result.proxyOwner) + chalk.dim(' (can execute upgrades via this ProxyAdmin)'));
      if (result.managedProxy) {
        line('Managed proxy:', addr(result.managedProxy) + chalk.dim(' (verified via its admin slot)'));
        line('Proxy impl:', addr(result.managedProxyImplementation));
      } else {
        line(
          'Managed proxy:',
          chalk.dim('not found (works for OZ v5 admins created by their proxy; needs an explorer API)')
        );
      }
      break;

    case 'none':
      line('Owner():', addr(result.proxyOwner) + acct(result.proxyOwner));
      break;
  }

  if (full) {
    printFullExtras(result, line);
  }
}

function printShortTable(results: ProxyInfoResult[]): void {
  console.log();
  console.log(`${'Chain'.padEnd(15)} ${'Chain ID'.padEnd(10)} Proxy type`);
  console.log('─'.repeat(50));

  for (const result of results) {
    const chainCol = result.chain.padEnd(15);
    const idCol = result.chainId.toString().padEnd(10);

    if (result.error) {
      const isNoCode = result.error === 'no code at address';
      console.log(`${chainCol} ${idCol} ${isNoCode ? chalk.dim(result.error) : chalk.red(result.error)}`);
    } else {
      const type = result.proxyType ?? 'none';
      const label = SHORT_TYPE_LABELS[type] ?? type;
      console.log(`${chainCol} ${idCol} ${type === 'none' ? chalk.dim(label) : chalk.cyan(label)}`);
    }
  }
}

export async function proxyInfoCommand(
  address: string,
  options: ContractProxyInfoOptions
): Promise<void> {
  loadEnv();

  if (!isAddress(address)) {
    console.error(chalk.red(`Invalid Ethereum address: ${address}`));
    process.exit(1);
  }

  if (options.short && options.full) {
    console.error(chalk.red('--short and --full are mutually exclusive'));
    process.exit(1);
  }
  const mode: InspectMode = options.short ? 'short' : options.full ? 'full' : 'normal';

  const profile = await loadProfile(options.profile);
  const chains = selectChains(options.chain, options.excludeChain, profile);
  const results: ProxyInfoResult[] = [];

  for (const chain of chains) {
    const resolved = resolveChain(chain, profile);
    if (!resolved.endpoint) {
      results.push({ chain, chainId: resolved.chainId, address, error: resolved.error });
      continue;
    }

    const provider = createProvider(resolved.endpoint, resolved.chainId);
    try {
      results.push(await inspectProxy(provider, resolved, address, mode));
    } catch (err) {
      results.push({ chain, chainId: resolved.chainId, address, error: (err as Error).message });
    } finally {
      provider.destroy();
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log();
  console.log(`Proxy Info: ${chalk.bold(address)}`);

  if (options.short) {
    printShortTable(results);
  } else {
    for (const result of results) {
      printResult(result, !!options.full);
    }
    if (options.full) {
      printCodeHashSummary(results);
    }
  }

  console.log();
}

/**
 * Cross-chain comparison: warn when the implementation bytecode differs
 * between chains (different build or lagging version).
 */
function printCodeHashSummary(results: ProxyInfoResult[]): void {
  const withHash = results.filter((r) => r.implementationCodeHash);
  if (withHash.length < 2) {
    return;
  }

  const groups = new Map<string, string[]>();
  for (const result of withHash) {
    const hash = result.implementationCodeHash as string;
    groups.set(hash, [...(groups.get(hash) ?? []), result.chain]);
  }

  console.log();
  if (groups.size === 1) {
    console.log(
      chalk.green(`Implementation bytecode is identical on all ${withHash.length} chains`)
    );
  } else {
    console.log(chalk.yellow(`Implementation bytecode DIFFERS across chains (${groups.size} variants):`));
    for (const [hash, chains] of groups) {
      console.log(`  ${chalk.dim(hash.slice(0, 18) + '…')} ${chains.join(', ')}`);
    }
  }
}
