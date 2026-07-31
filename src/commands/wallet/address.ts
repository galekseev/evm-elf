/**
 * address command - derive the wallet address from a private key
 * Accepts a raw hex key or the name of an env variable from workspace .env. No RPC needed.
 */

import chalk from 'chalk';
import type { WalletAddressOptions } from '../../types.js';
import { resolvePrivateKey, deriveAddress } from '../../lib/wallet.js';

export function addressCommand(key: string, options: WalletAddressOptions): void {
  let address: string;
  try {
    address = deriveAddress(resolvePrivateKey(key));
  } catch (error) {
    console.error(chalk.red((error as Error).message.replace('--private-key', 'key argument')));
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify({ address }, null, 2));
    return;
  }

  console.log(address);
}
