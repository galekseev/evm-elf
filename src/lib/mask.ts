/**
 * Masking for configured values that may be secrets.
 *
 * A ${VAR} reference is not itself a secret, so it stays readable and carries a
 * marker when the variable has no value: that is how a missing key is spotted
 * without printing one. Anything else is treated as a literal key.
 */

import chalk from 'chalk';

const ENV_REF = /^\$\{([^}]+)\}$/;

export function maskValue(value: string, reveal: boolean): string {
  const ref = ENV_REF.exec(value);
  if (ref) {
    return process.env[ref[1]] === undefined ? `${value} ${chalk.yellow('(unset)')}` : value;
  }
  if (reveal) {
    return value;
  }
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}
