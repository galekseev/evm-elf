/**
 * contract transfer-ownership command - call transferOwnership(newOwner) on a single chain
 * Dry-run by default; --exec sends the transaction.
 */

import chalk from 'chalk';
import { Contract, Wallet, getAddress, isAddress } from 'ethers';
import type {
  ContractTransferOwnershipOptions,
  TransferOwnershipResult,
} from '../../types.js';
import { loadProfile, resolveChain } from '../../lib/chains.js';
import { createProvider } from '../../lib/rpc.js';
import { resolvePrivateKey } from '../../lib/wallet.js';
import { OWNABLE_ABI, hasCode, revertReason } from '../../lib/proxy.js';

export async function transferOwnershipCommand(
  address: string,
  newOwner: string,
  options: ContractTransferOwnershipOptions
): Promise<void> {
  if (!isAddress(address)) {
    console.error(chalk.red(`Invalid contract address: ${address}`));
    process.exit(1);
  }
  if (!isAddress(newOwner)) {
    console.error(chalk.red(`Invalid new owner address: ${newOwner}`));
    process.exit(1);
  }

  if (!options.chain || options.chain.includes(',')) {
    console.error(chalk.red('transfer-ownership requires exactly one chain (-c <chain>)'));
    process.exit(1);
  }
  const chain = options.chain.trim();

  let privateKey: string;
  try {
    privateKey = resolvePrivateKey(options.privateKey);
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  const profile = await loadProfile(options.profile);
  const resolved = resolveChain(chain, profile);
  if (!resolved.endpoint) {
    console.error(chalk.red(`${chain}: ${resolved.error}`));
    process.exit(1);
  }

  const provider = createProvider(resolved.endpoint, resolved.chainId);
  const wallet = new Wallet(privateKey, provider);
  const dryRun = !options.exec;

  const result: TransferOwnershipResult = {
    chain,
    chainId: resolved.chainId,
    address,
    newOwner: getAddress(newOwner),
    signer: wallet.address,
    dryRun,
  };

  try {
    if (!(await hasCode(provider, address))) {
      throw new Error('no code at address');
    }

    const contract = new Contract(address, OWNABLE_ABI, wallet);

    try {
      result.currentOwner = (await contract.owner()) as string;
    } catch {
      throw new Error('contract has no owner() function');
    }

    const signerIsOwner = result.currentOwner.toLowerCase() === wallet.address.toLowerCase();

    // Static call catches reverts (e.g. OwnableUnauthorizedAccount) before sending
    let staticCallError: string | undefined;
    try {
      await contract.transferOwnership.staticCall(result.newOwner);
    } catch (err) {
      staticCallError = revertReason(err);
    }

    if (dryRun) {
      if (options.json) {
        console.log(JSON.stringify({ ...result, ...(staticCallError ? { error: staticCallError } : {}) }, null, 2));
        return;
      }

      console.log();
      console.log(`Transfer Ownership ${chalk.yellow('(dry run)')} on ${chalk.bold(chain)}`);
      console.log(`  Contract:      ${address}`);
      console.log(`  Current owner: ${result.currentOwner}`);
      console.log(`  New owner:     ${result.newOwner}`);
      console.log(`  Signer:        ${wallet.address}`);
      console.log();
      if (!signerIsOwner) {
        console.log(chalk.yellow('  Warning: signer is NOT the current owner'));
      }
      if (staticCallError) {
        console.log(chalk.red(`  Static call reverted: ${staticCallError}`));
      } else {
        console.log(chalk.green('  Static call succeeded'));
      }
      console.log();
      console.log(chalk.dim('  Re-run with --exec to send the transaction'));
      console.log();
      return;
    }

    if (staticCallError) {
      throw new Error(`static call reverted, not sending: ${staticCallError}`);
    }

    const tx = await contract.transferOwnership(result.newOwner);
    const receipt = await tx.wait();
    result.txHash = tx.hash;
    result.blockNumber = receipt?.blockNumber;
    result.finalOwner = (await contract.owner()) as string;

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.green(`Ownership transferred on ${chain}`));
    console.log(`  Contract:       ${address}`);
    console.log(`  Previous owner: ${result.currentOwner}`);
    console.log(`  New owner:      ${chalk.cyan(result.finalOwner)}`);
    console.log(`  Tx hash:        ${chalk.cyan(result.txHash)}`);
    console.log(`  Block:          ${result.blockNumber}`);
    console.log();
  } catch (error) {
    const message = (error as Error).message;
    if (options.json) {
      console.log(JSON.stringify({ ...result, error: message }, null, 2));
    } else {
      console.error(chalk.red(message));
    }
    process.exit(1);
  } finally {
    provider.destroy();
  }
}
