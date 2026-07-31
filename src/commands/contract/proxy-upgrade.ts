/**
 * contract proxy-upgrade command - upgrade a transparent proxy via ProxyAdmin.upgradeAndCall
 * Dry-run by default; --exec sends the transaction.
 */

import chalk from 'chalk';
import { Contract, Wallet, getAddress, isAddress, isHexString } from 'ethers';
import type {
  ContractUpgradeOptions,
  RpcProfile,
  UpgradeProxyResult,
} from '../../types.js';
import { loadEnv } from '../../lib/env.js';
import { loadProfile, loadKnownChains, resolveChain } from '../../lib/chains.js';
import { createProvider } from '../../lib/rpc.js';
import { resolvePrivateKey } from '../../lib/wallet.js';
import {
  EIP1967_ADMIN_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  PROXY_ADMIN_ABI,
  getStorageAddress,
  hasCode,
  revertReason,
} from '../../lib/proxy.js';

export async function proxyUpgradeCommand(
  proxy: string,
  newImplementation: string,
  options: ContractUpgradeOptions
): Promise<void> {
  loadEnv();

  if (!isAddress(proxy)) {
    console.error(chalk.red(`Invalid proxy address: ${proxy}`));
    process.exit(1);
  }
  if (!isAddress(newImplementation)) {
    console.error(chalk.red(`Invalid implementation address: ${newImplementation}`));
    process.exit(1);
  }

  const data = options.data ?? '0x';
  if (!isHexString(data)) {
    console.error(chalk.red(`Invalid --data: must be a 0x-prefixed hex string, got: ${data}`));
    process.exit(1);
  }

  if (!options.chain || options.chain.includes(',')) {
    console.error(chalk.red('proxy-upgrade requires exactly one chain (-c <chain>)'));
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

  const knownChains = await loadKnownChains();
  let profile: RpcProfile | undefined;
  if (options.profile) {
    profile = await loadProfile(options.profile);
  }

  const resolved = resolveChain(chain, profile, knownChains);
  if (!resolved.endpoint) {
    console.error(chalk.red(`${chain}: ${resolved.error}`));
    process.exit(1);
  }

  const provider = createProvider(resolved.endpoint, resolved.chainId);
  const wallet = new Wallet(privateKey, provider);
  const dryRun = !options.exec;

  const result: UpgradeProxyResult = {
    chain,
    chainId: resolved.chainId,
    proxy,
    newImplementation: getAddress(newImplementation),
    signer: wallet.address,
    dryRun,
  };

  try {
    if (!(await hasCode(provider, proxy))) {
      throw new Error('no code at proxy address');
    }

    const admin = await getStorageAddress(provider, proxy, EIP1967_ADMIN_SLOT);
    if (!admin) {
      throw new Error('EIP-1967 admin slot is empty (not a transparent proxy?)');
    }
    result.proxyAdmin = admin;

    if (!(await hasCode(provider, admin))) {
      throw new Error(
        `admin ${admin} is an EOA, not a ProxyAdmin contract (upgrade it directly via the proxy)`
      );
    }

    result.currentImplementation =
      (await getStorageAddress(provider, proxy, EIP1967_IMPLEMENTATION_SLOT)) ?? undefined;

    const newImplHasCode = await hasCode(provider, result.newImplementation);

    const proxyAdmin = new Contract(admin, PROXY_ADMIN_ABI, wallet);

    try {
      result.adminOwner = (await proxyAdmin.owner()) as string;
    } catch {
      // non-Ownable ProxyAdmin - leave adminOwner unset
    }

    const signerIsAdminOwner =
      result.adminOwner !== undefined &&
      result.adminOwner.toLowerCase() === wallet.address.toLowerCase();

    let staticCallError: string | undefined;
    try {
      await proxyAdmin.upgradeAndCall.staticCall(proxy, result.newImplementation, data, {
        value: 0,
      });
    } catch (err) {
      staticCallError = revertReason(err);
    }

    if (dryRun) {
      if (options.json) {
        console.log(
          JSON.stringify({ ...result, ...(staticCallError ? { error: staticCallError } : {}) }, null, 2)
        );
        return;
      }

      console.log();
      console.log(`Upgrade Proxy ${chalk.yellow('(dry run)')} on ${chalk.bold(chain)}`);
      console.log(`  Proxy:          ${proxy}`);
      console.log(`  Proxy admin:    ${result.proxyAdmin}`);
      console.log(`  Admin owner:    ${result.adminOwner ?? chalk.dim('n/a')}`);
      console.log(`  Current impl:   ${result.currentImplementation ?? chalk.dim('n/a')}`);
      console.log(`  New impl:       ${result.newImplementation}`);
      console.log(`  Call data:      ${data}`);
      console.log(`  Signer:         ${wallet.address}`);
      console.log();
      if (!newImplHasCode) {
        console.log(chalk.yellow('  Warning: new implementation has NO code at that address'));
      }
      if (result.adminOwner && !signerIsAdminOwner) {
        console.log(chalk.yellow('  Warning: signer is NOT the ProxyAdmin owner'));
      }
      if (
        result.currentImplementation &&
        result.currentImplementation.toLowerCase() === result.newImplementation.toLowerCase()
      ) {
        console.log(chalk.yellow('  Warning: proxy already points to this implementation'));
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

    if (!newImplHasCode) {
      throw new Error('new implementation has no code, not sending');
    }
    if (staticCallError) {
      throw new Error(`static call reverted, not sending: ${staticCallError}`);
    }

    const tx = await proxyAdmin.upgradeAndCall(proxy, result.newImplementation, data, {
      value: 0,
    });
    const receipt = await tx.wait();
    result.txHash = tx.hash;
    result.blockNumber = receipt?.blockNumber;
    result.finalImplementation =
      (await getStorageAddress(provider, proxy, EIP1967_IMPLEMENTATION_SLOT)) ?? undefined;

    const confirmed =
      result.finalImplementation?.toLowerCase() === result.newImplementation.toLowerCase();

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.green(`Proxy upgraded on ${chain}`));
    console.log(`  Proxy:         ${proxy}`);
    console.log(`  Previous impl: ${result.currentImplementation ?? chalk.dim('n/a')}`);
    console.log(`  New impl:      ${chalk.cyan(result.finalImplementation ?? 'unknown')}`);
    console.log(`  Tx hash:       ${chalk.cyan(result.txHash)}`);
    console.log(`  Block:         ${result.blockNumber}`);
    if (!confirmed) {
      console.log(
        chalk.yellow('  Warning: implementation slot does not match the requested implementation')
      );
    }
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
