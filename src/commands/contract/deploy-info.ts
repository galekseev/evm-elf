/**
 * contract deploy-info command - how a contract was deployed, across chains
 *
 * Reports CREATE, CREATE2 or CREATE3, and for the deterministic ones the salt,
 * recovered from the creation transaction and confirmed by recomputing the
 * address. Nothing is reported as deterministic on the strength of a factory's
 * name alone.
 */

import chalk from 'chalk';
import { Contract, getAddress, isAddress, keccak256 } from 'ethers';
import type { JsonRpcProvider, TransactionResponse } from 'ethers';
import type { ContractDeployInfoOptions, DeployInfoResult } from '../../types.js';
import { loadProfile, resolveChain, selectChains, type ResolvedChain } from '../../lib/chains.js';
import { createProvider } from '../../lib/rpc.js';
import { describeAccount, OWNABLE_ABI } from '../../lib/proxy.js';
import {
  CREATE3_DEPLOYER_ABI,
  checksumAddress,
  create3ProxyFromRuntime,
  decodeFactoryCall,
  factoryName,
  findCreateNonce,
  hintedMethod,
  matchesCreate,
  recoverDeployment,
  type DeterministicMatch,
} from '../../lib/deployment.js';
import { ExplorerChain } from '../../lib/explorer/index.js';

/**
 * Everything the recovery needs from one creation transaction, with the salt
 * candidates a factory may have logged rather than passed in its calldata.
 */
async function recover(
  provider: JsonRpcProvider,
  chainId: number,
  address: string,
  tx: TransactionResponse,
  deployers: string[],
  initCodes: string[]
): Promise<DeterministicMatch | null> {
  const senders = [tx.from, ...(tx.to ? [tx.to] : [])];
  const input = { address, chainId, senders, deployers, calldata: tx.data, initCodes };

  const fromCalldata = recoverDeployment(input);
  if (fromCalldata) {
    return fromCalldata;
  }
  // CreateX's salt-less overloads generate the salt on chain, so it exists only
  // in an event. Costs a second request, and only when the calldata held nothing.
  const receipt = await provider.getTransactionReceipt(tx.hash);
  if (!receipt) {
    return null;
  }
  const logTopics = receipt.logs.flatMap((log) => [...log.topics]);
  return recoverDeployment({ ...input, logTopics });
}

/** Nonce at which a contract created the address, when it is within reach */
async function createNonceOf(
  provider: JsonRpcProvider,
  creator: string,
  address: string
): Promise<number | undefined> {
  try {
    return findCreateNonce(address, creator, await provider.getTransactionCount(creator));
  } catch {
    return undefined;
  }
}

/**
 * Concise text for a chain that failed. ethers puts a sentence in shortMessage
 * and a paragraph of request and response detail in message, and the paragraph
 * would take the table's row apart.
 */
function errorText(err: unknown): string {
  const error = err as { shortMessage?: string; message?: string };
  return error.shortMessage ?? error.message ?? String(err);
}

async function tryOwner(provider: JsonRpcProvider, address: string): Promise<string | undefined> {
  try {
    const contract = new Contract(address, OWNABLE_ABI, provider);
    return (await contract.owner()) as string;
  } catch {
    return undefined;
  }
}

/**
 * A 1inch-style deployer's own view of where a salt lands. It confirms the
 * factory is a CREATE3 deployer of that family rather than an address that
 * happened to fit the arithmetic.
 */
async function addressOfAgrees(
  provider: JsonRpcProvider,
  factory: string,
  salt: string,
  address: string
): Promise<boolean | undefined> {
  try {
    const contract = new Contract(factory, CREATE3_DEPLOYER_ABI, provider);
    const derived = (await contract.addressOf(salt)) as string;
    return getAddress(derived) === getAddress(address);
  } catch {
    return undefined;
  }
}

/**
 * Full-mode enrichment: the creation date when the explorer did not give one,
 * the init code hash, the fate of a CREATE3 proxy, and the factory's owner -
 * which for an Ownable factory is the only account that can deploy through it.
 */
async function enrichFull(
  provider: JsonRpcProvider,
  result: DeployInfoResult,
  tx: TransactionResponse | null,
  creationBytecode: string | undefined
): Promise<void> {
  if (result.createdAt === undefined && tx?.blockNumber) {
    try {
      const block = await provider.getBlock(tx.blockNumber);
      result.createdAt = block?.timestamp;
    } catch {
      // date unavailable
    }
  }

  if (result.initCodeHash === undefined && creationBytecode && creationBytecode !== '0x') {
    result.initCodeHash = keccak256(creationBytecode);
  }

  if (result.create3Proxy) {
    const code = await provider.getCode(result.create3Proxy);
    result.create3ProxyDestroyed = code === '0x';
    const surviving = create3ProxyFromRuntime(code);
    if (surviving) {
      result.create3ProxyKind = surviving.label;
    }
  }

  if (result.factory) {
    const owner = await tryOwner(provider, result.factory);
    if (owner) {
      result.factoryOwner = owner;
      result.factoryOwnerInfo = await describeAccount(provider, owner);
    }
    if (result.salt) {
      const agrees = await addressOfAgrees(provider, result.factory, result.salt, result.address);
      if (agrees !== undefined) {
        result.addressOfMatches = agrees;
      }
    }
  }
}

async function inspectDeployment(
  provider: JsonRpcProvider,
  resolved: ResolvedChain,
  explorer: ExplorerChain,
  address: string,
  full: boolean
): Promise<DeployInfoResult> {
  const result: DeployInfoResult = { chain: resolved.chain, chainId: resolved.chainId, address };

  if ((await provider.getCode(address)) === '0x') {
    result.error = 'no code at address';
    return result;
  }

  const creation = await explorer.getContractCreation(address);
  if (!creation) {
    // A source that answers "no record" and one that does not answer at all
    // arrive here the same way, so the wording claims neither.
    result.error = explorer.configured
      ? 'no creation record from the explorer'
      : 'needs an explorer API';
    return result;
  }
  result.creationTxHash = creation.txHash;
  result.createdAt = creation.timestamp;

  const tx = await provider.getTransaction(creation.txHash);
  if (!tx) {
    // The explorer knows the transaction, this endpoint no longer serves it.
    result.method = 'unknown';
    result.deployer = checksumAddress(creation.creator);
    if (creation.factory) {
      result.factory = checksumAddress(creation.factory);
      result.factoryName = factoryName(creation.factory);
    }
    result.saltNote = 'creation transaction not available from this RPC endpoint';
    if (full) {
      await enrichFull(provider, result, null, creation.creationBytecode);
    }
    return result;
  }
  result.deployer = tx.from;

  // Sent straight from an account: the address follows from the sender and nonce.
  if (!tx.to && matchesCreate(address, tx.from, tx.nonce)) {
    result.method = 'create';
    result.deployerNonce = tx.nonce;
    result.verified = true;
    result.initCodeHash = tx.data === '0x' ? undefined : keccak256(tx.data);
    if (full) {
      await enrichFull(provider, result, tx, creation.creationBytecode);
    }
    return result;
  }

  const deployers = [
    ...(tx.to ? [tx.to] : []),
    ...(creation.factory ? [creation.factory] : []),
    creation.creator,
  ];
  const initCodes = [
    ...(creation.creationBytecode ? [creation.creationBytecode] : []),
    ...(tx.to ? [] : [tx.data]),
  ];
  const match = await recover(provider, resolved.chainId, address, tx, deployers, initCodes);

  if (match) {
    result.method = match.method;
    result.factory = match.deployer;
    result.factoryName = factoryName(match.deployer);
    result.salt = match.salt;
    result.guardedSalt = match.guardedSalt;
    result.guardLabel = match.guardLabel;
    result.verified = true;
    if (match.method === 'create3') {
      result.create3Proxy = match.proxy;
      result.create3ProxyKind = match.proxyKind?.label;
    } else {
      result.initCodeHash = match.initCodeHash;
    }
  } else {
    // No salt reproduces the address, so the creating contract used a plain
    // CREATE. Its nonce counts its creations, which bounds a search for the one
    // it used and makes the answer reproducible rather than inferred.
    const creator = checksumAddress(creation.factory ?? tx.to ?? creation.creator);
    result.factory = creator;
    result.factoryName = factoryName(creator);
    const nonce = await createNonceOf(provider, creator, address);
    if (nonce !== undefined) {
      result.method = 'create';
      result.factoryNonce = nonce;
      result.verified = true;
    } else {
      result.method = hintedMethod(tx.data) ?? 'unknown';
      result.verified = false;
      result.saltNote = decodeFactoryCall(tx.data)
        ? 'not recovered - the factory derives it from values not in the call'
        : 'not recovered - no 32-byte word in the calldata reproduces the address';
    }
  }

  if (full) {
    await enrichFull(provider, result, tx, creation.creationBytecode);
  }
  return result;
}

// ============================================================================
// Output
// ============================================================================

const METHOD_LABELS: Record<string, string> = {
  create: 'CREATE',
  create2: 'CREATE2',
  create3: 'CREATE3',
  unknown: 'unknown',
};

function methodLabel(result: DeployInfoResult): string {
  return METHOD_LABELS[result.method ?? 'unknown'] ?? 'unknown';
}

function formatDate(unixSeconds: number | undefined): string | undefined {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString().slice(0, 10) : undefined;
}

/**
 * One row per chain, 79 columns wide so it survives an 80-column terminal. The
 * salt is 66 characters on its own, so it lives in the summary and in --full.
 */
function printTable(results: DeployInfoResult[]): void {
  console.log();
  console.log(
    `${'Chain'.padEnd(15)} ${'Chain ID'.padEnd(10)} ${'Method'.padEnd(9)} Deployer / factory`
  );
  console.log('─'.repeat(79));

  for (const result of results) {
    const chainCol = result.chain.padEnd(15);
    const idCol = result.chainId.toString().padEnd(10);

    if (result.error) {
      const dim = result.error === 'no code at address';
      console.log(`${chainCol} ${idCol} ${dim ? chalk.dim(result.error) : chalk.red(result.error)}`);
      continue;
    }

    const label = methodLabel(result).padEnd(9);
    const method = result.verified ? chalk.cyan(label) : chalk.yellow(label);
    const who = result.factory ?? result.deployer ?? '';
    console.log(`${chainCol} ${idCol} ${method} ${who}`);
  }
}

function printVerified(result: DeployInfoResult, line: (label: string, value: string) => void): void {
  if (!result.verified) {
    line('Verified:', chalk.yellow('no - the reported values do not reproduce the address'));
    return;
  }

  const checks: string[] = [];
  if (result.method === 'create') {
    const who = result.factoryNonce !== undefined ? 'creator' : 'deployer';
    checks.push(`address matches keccak(rlp(${who}, nonce))`);
  }
  if (result.method === 'create2') {
    checks.push('address matches CREATE2(factory, salt, init code hash)');
  }
  if (result.method === 'create3') {
    const salt = result.guardedSalt ? 'guarded salt' : 'salt';
    checks.push(`proxy matches CREATE2(factory, ${salt}, proxy init code hash)`);
    checks.push('address matches CREATE(proxy, 1)');
  }
  if (result.addressOfMatches) {
    checks.push('factory addressOf(salt) returns this address');
  }

  if (checks.length === 0) {
    return;
  }

  line('Verified:', chalk.green(checks[0]) + (checks.length > 1 ? ',' : ''));
  for (const [index, check] of checks.slice(1).entries()) {
    const last = index === checks.length - 2;
    console.log(`${' '.repeat(18)}${chalk.green(check)}${last ? '' : ','}`);
  }
}

function printResult(result: DeployInfoResult): void {
  const line = (label: string, value: string): void =>
    console.log(`  ${label.padEnd(15)} ${value}`);
  const note = (text: string): void => console.log(`${' '.repeat(18)}${chalk.dim(text)}`);

  console.log();
  console.log(`${chalk.bold(result.chain)} (chain ID ${result.chainId})`);

  if (result.error) {
    console.log(`  ${chalk.red(result.error)}`);
    return;
  }

  const method = methodLabel(result);
  if (result.method === 'create') {
    const how = result.factoryNonce !== undefined ? ' (by contract, nonce-based' : ' (nonce-based';
    line('Method:', chalk.bold(method) + chalk.dim(`${how}, not reproducible on another chain)`));
  } else {
    line('Method:', chalk.bold(method));
  }

  if (result.deployer) {
    line(result.factory ? 'Sender:' : 'Deployer:', chalk.cyan(result.deployer));
  }
  if (result.deployerNonce !== undefined) {
    line('Deployer nonce:', chalk.dim(result.deployerNonce.toString()));
  }
  if (result.factory) {
    const role = result.factoryNonce !== undefined ? 'Created by:' : 'Factory:';
    line(role, chalk.cyan(result.factory) + (result.factoryName ? chalk.dim(` (${result.factoryName})`) : ''));
  }
  if (result.factoryNonce !== undefined) {
    line('Creator nonce:', chalk.dim(result.factoryNonce.toString()));
  }
  if (result.factoryOwner) {
    const info = result.factoryOwnerInfo;
    const kind =
      info?.kind === 'safe'
        ? `Safe ${info.threshold}/${info.ownersCount}, `
        : info?.kind === 'contract'
          ? 'contract, '
          : '';
    line(
      'Factory owner:',
      chalk.cyan(result.factoryOwner) + chalk.dim(` (${kind}only account that can deploy here)`)
    );
  }

  if (result.salt) {
    line('Salt:', chalk.cyan(result.salt) + (result.guardedSalt ? chalk.dim(' (submitted)') : ''));
  } else if (result.saltNote) {
    line('Salt:', chalk.yellow(result.saltNote));
  }
  if (result.guardedSalt) {
    line('Guarded salt:', chalk.cyan(result.guardedSalt));
    if (result.guardLabel) {
      note(result.guardLabel);
    }
  }

  if (result.create3Proxy) {
    const fate = result.create3ProxyDestroyed
      ? chalk.dim(' (self-destructed, no code)')
      : result.create3ProxyDestroyed === false
        ? chalk.dim(' (still deployed)')
        : '';
    line('CREATE3 proxy:', chalk.cyan(result.create3Proxy) + fate);
    if (result.create3ProxyKind) {
      line('Proxy shape:', chalk.dim(result.create3ProxyKind));
    }
  }

  printVerified(result, line);

  if (result.initCodeHash) {
    line('Init code hash:', chalk.dim(result.initCodeHash));
    if (result.method === 'create3') {
      note('does not affect the address under CREATE3');
    }
  }
  if (result.creationTxHash) {
    line('Creation tx:', chalk.dim(result.creationTxHash));
  }
  const when = formatDate(result.createdAt);
  if (when) {
    line('Created on:', chalk.dim(when));
  }
}

/** How a deployment reads when comparing chains: same method, factory and salt */
function variantLabel(result: DeployInfoResult): string {
  const method = methodLabel(result);
  if (result.factory) {
    const name = result.factoryName ?? result.factory;
    return `${method} via ${name}`;
  }
  return `${method} by ${result.deployer ?? 'unknown'}`;
}

/**
 * The question a multi-chain deterministic deployment exists to answer: is it
 * the same everywhere? Grouped by what determines the address, so a chain
 * deployed with another salt stands out.
 */
function printSummary(results: DeployInfoResult[]): void {
  const usable = results.filter((result) => !result.error && result.method);
  if (usable.length < 2) {
    return;
  }

  const groups = new Map<string, { label: string; salt?: string; chains: string[] }>();
  for (const result of usable) {
    const key = `${result.method}|${result.factory ?? result.deployer ?? ''}|${result.salt ?? ''}`;
    const group = groups.get(key) ?? {
      label: variantLabel(result),
      ...(result.salt ? { salt: result.salt } : {}),
      chains: [],
    };
    group.chains.push(result.chain);
    groups.set(key, group);
  }

  console.log();
  if (groups.size === 1) {
    const [group] = [...groups.values()];
    console.log(
      chalk.green(`Method, factory and salt are identical on all ${usable.length} chains`)
    );
    console.log(`  ${group.label}`);
    if (group.salt) {
      console.log(`  salt ${chalk.cyan(group.salt)}`);
    }
    return;
  }

  console.log(chalk.yellow(`Deployment differs across chains (${groups.size} variants):`));
  for (const group of groups.values()) {
    console.log(`  ${chalk.bold(group.chains.join(', '))}: ${group.label}`);
    if (group.salt) {
      console.log(`    salt ${chalk.cyan(group.salt)}`);
    }
  }
}

/**
 * Said once per run, on stderr so that --json stays parseable, and only when a
 * lookup actually wanted a source.
 */
function reportSkippedLookups(skipped: boolean): void {
  if (!skipped) {
    return;
  }
  console.error(
    chalk.dim(
      "Skipped explorer lookups: no API key configured. Add one with: evm explorer set etherscan '${ETHERSCAN_API_KEY}'"
    )
  );
}

export async function deployInfoCommand(
  address: string,
  options: ContractDeployInfoOptions
): Promise<void> {
  if (!isAddress(address)) {
    console.error(chalk.red(`Invalid Ethereum address: ${address}`));
    process.exit(1);
  }

  const profile = await loadProfile(options.profile);
  const chains = selectChains(options.chain, options.excludeChain, profile);
  const results: DeployInfoResult[] = [];
  let skippedLookups = false;

  for (const chain of chains) {
    const resolved = resolveChain(chain, profile);
    if (!resolved.endpoint) {
      results.push({ chain, chainId: resolved.chainId, address, error: resolved.error });
      continue;
    }

    const provider = createProvider(resolved.endpoint, resolved.chainId);
    const explorer = new ExplorerChain(profile.explorers, resolved);
    try {
      const result = await inspectDeployment(
        provider,
        resolved,
        explorer,
        address,
        !!options.full
      );
      if (explorer.source) {
        result.explorerSource = explorer.source;
      }
      results.push(result);
    } catch (err) {
      results.push({ chain, chainId: resolved.chainId, address, error: errorText(err) });
    } finally {
      skippedLookups ||= explorer.skipped;
      provider.destroy();
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    reportSkippedLookups(skippedLookups);
    return;
  }

  console.log();
  console.log(`Deploy Info: ${chalk.bold(address)}`);

  if (options.full) {
    for (const result of results) {
      printResult(result);
    }
  } else {
    printTable(results);
  }

  printSummary(results);
  console.log();
  reportSkippedLookups(skippedLookups);
}
