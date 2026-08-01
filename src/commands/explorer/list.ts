/**
 * explorer list command - show the block explorer API keys a profile configures.
 * Keys are masked unless --reveal: a profile may hold a literal one, and they
 * are printed last so that colour codes cannot throw off the column widths.
 */

import chalk from 'chalk';
import type { ExplorerListOptions } from '../../types.js';
import { loadProfile } from '../../lib/chains.js';
import { EXPLORER_NAMES, explorerBaseUrl } from '../../lib/explorer/index.js';
import { maskValue } from '../../lib/mask.js';

const COL = {
  explorer: 13,
  endpoint: 36,
} as const;

export async function explorerListCommand(options: ExplorerListOptions): Promise<void> {
  const profile = await loadProfile(options.profile);

  if (options.json) {
    console.log(
      JSON.stringify(
        { profile: profile.name, path: profile.path, explorers: profile.explorers },
        null,
        2
      )
    );
    return;
  }

  console.log();
  console.log(`Profile ${chalk.bold(profile.name)} ${chalk.dim(profile.path)}`);
  console.log();

  const header =
    ['Explorer'.padEnd(COL.explorer), 'Endpoint'.padEnd(COL.endpoint)].join(' ') + ' API Key';
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const name of EXPLORER_NAMES) {
    const configured = profile.explorers[name];
    // maskValue colours its own (unset) marker, so it is printed as it comes
    const key = configured
      ? maskValue(configured, Boolean(options.reveal))
      : chalk.dim('not set');
    console.log(
      [name.padEnd(COL.explorer), chalk.dim(explorerBaseUrl(name).padEnd(COL.endpoint))].join(' ') +
        ` ${key}`
    );
  }

  console.log();
  console.log(
    chalk.dim('Tried in this order, after a chain that names its own explorer_api.')
  );
  console.log();
}
