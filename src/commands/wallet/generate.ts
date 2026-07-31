/**
 * generate command - create a new random HD wallet
 * Prints the mnemonic, address and private key to stdout. No RPC needed.
 */

import chalk from 'chalk';
import { HDNodeWallet, Mnemonic, randomBytes } from 'ethers';
import type { GenerateWalletResult, WalletGenerateOptions } from '../../types.js';

export function generateCommand(options: WalletGenerateOptions): void {
  const words = Number(options.words ?? 12);
  if (words !== 12 && words !== 24) {
    console.error(chalk.red(`--words must be 12 or 24, got: ${options.words}`));
    process.exit(1);
  }

  // 12 words = 16 bytes of entropy, 24 words = 32 bytes
  const entropyBytes = words === 12 ? 16 : 32;
  const mnemonic = Mnemonic.fromEntropy(randomBytes(entropyBytes));
  const wallet = HDNodeWallet.fromMnemonic(mnemonic);

  const result: GenerateWalletResult = {
    address: wallet.address,
    mnemonic: mnemonic.phrase,
    privateKey: wallet.privateKey,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log();
  console.log(chalk.bold('Generated Wallet'));
  console.log();
  console.log(`Address:     ${chalk.cyan(result.address)}`);
  console.log(`Mnemonic:    ${chalk.yellow(result.mnemonic)}`);
  console.log(`Private key: ${chalk.yellow(result.privateKey)}`);
  console.log();
  console.log(chalk.dim('Store the mnemonic and private key securely — they are shown only once.'));
  console.log();
}
