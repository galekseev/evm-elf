/**
 * Private key resolution and ethers Wallet helpers
 */

import { getAddress, isAddress, Wallet } from 'ethers';

const HEX_KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;

function withHexPrefix(value: string): string {
  return value.startsWith('0x') ? value : `0x${value}`;
}

/**
 * Resolve a private key from a CLI flag value.
 * Accepts a raw hex key (with or without 0x) or the name of an env variable
 * holding one (workspace .env is loaded beforehand).
 * Never log the returned value.
 */
export function resolvePrivateKey(flagValue: string): string {
  let key = flagValue;
  if (!HEX_KEY_RE.test(key)) {
    const fromEnv = process.env[flagValue];
    if (fromEnv === undefined) {
      throw new Error(
        `--private-key is neither a hex key nor a set environment variable: ${flagValue}`
      );
    }
    key = fromEnv;
  }
  if (!HEX_KEY_RE.test(key)) {
    throw new Error('Private key must be a 32-byte hex string');
  }
  return withHexPrefix(key);
}

/**
 * Derive the wallet address from a private key (no provider needed)
 */
export function deriveAddress(privateKey: string): string {
  return new Wallet(privateKey).address;
}

/**
 * Resolve a wallet address from a CLI argument that may be:
 * - an Ethereum address (used as-is, checksummed)
 * - a 32-byte hex private key (address is derived; never logged)
 * - the name of an env variable holding either of the above
 * Address vs key is disambiguated by hex length (40 vs 64 chars).
 */
export function resolveAddress(input: string): string {
  const fromValue = (value: string): string | undefined => {
    if (isAddress(value)) return getAddress(value);
    if (HEX_KEY_RE.test(value)) return deriveAddress(withHexPrefix(value));
    return undefined;
  };

  const direct = fromValue(input);
  if (direct) return direct;

  const fromEnv = process.env[input];
  if (fromEnv === undefined) {
    throw new Error(
      `Not an address, a private key, or a set environment variable: ${input}`
    );
  }
  const resolved = fromValue(fromEnv);
  if (!resolved) {
    throw new Error(`Env variable ${input} holds neither an address nor a 32-byte hex private key`);
  }
  return resolved;
}
