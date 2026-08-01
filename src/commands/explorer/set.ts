/**
 * explorer set command - store a block explorer API key in a profile.
 *
 * The key is checked against the explorer before it is written, the way
 * `evm chain set` checks the chain id against the RPC endpoint. A rejected key
 * would otherwise surface much later, and only as fields quietly going missing.
 */

import { existsSync } from 'fs';
import chalk from 'chalk';
import type { ExplorerSetOptions } from '../../types.js';
import { tryResolveEnvRefs } from '../../lib/env.js';
import { resolveProfileTarget } from '../../lib/chains.js';
import {
  EXPLORER_NAMES,
  isExplorerName,
  verifyExplorerKey,
} from '../../lib/explorer/index.js';
import { maskValue } from '../../lib/mask.js';
import {
  getExplorers,
  readProfileDocument,
  setExplorer,
  writeProfileDocument,
} from '../../lib/profile-file.js';

const VERIFY_HINT = 'Pass --no-verify to write the entry anyway.';

function fail(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

export async function explorerSetCommand(
  name: string,
  apiKey: string,
  options: ExplorerSetOptions
): Promise<void> {
  if (!isExplorerName(name)) {
    fail(`Unknown explorer '${name}': known explorers are ${EXPLORER_NAMES.join(', ')}`);
  }

  const configured = apiKey.trim();
  if (!configured) {
    fail(`Empty API key for '${name}': pass a key, or remove it with evm explorer remove ${name}`);
  }

  const { name: profileName, path: profilePath } = await resolveProfileTarget(options.profile);
  // Only the default profile is created on demand, so a -p that names anything
  // else is a typo rather than a request for a new profile.
  if (!existsSync(profilePath)) {
    fail(`Profile not found: ${profilePath}`);
  }
  const doc = await readProfileDocument(profilePath);
  const existing = getExplorers(doc)[name];

  let verified = false;
  if (options.verify !== false) {
    // ${VAR} is only resolved to reach the explorer, so an entry can be written
    // for a variable that is not in this shell as long as it is not verified.
    const resolved = tryResolveEnvRefs(configured);
    if (!resolved) {
      fail(`Could not resolve ${configured}: the environment variable is not set\n${VERIFY_HINT}`);
    }
    const probe = await verifyExplorerKey(name, resolved);
    if (!probe.ok) {
      fail(`${name} rejected the key: ${probe.reason}\n${VERIFY_HINT}`);
    }
    verified = true;
  }

  setExplorer(doc, name, configured);
  await writeProfileDocument(profilePath, doc);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          profile: profileName,
          path: profilePath,
          added: existing === undefined,
          explorer: name,
          verified,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(
    existing === undefined
      ? `Added ${chalk.bold(name)} to ${chalk.dim(profilePath)}`
      : `Updated ${chalk.bold(name)} in ${chalk.dim(profilePath)}`
  );
  console.log(`  api_key      ${maskValue(configured, false)}`);
  console.log(
    verified
      ? chalk.dim('  key accepted by the explorer')
      : chalk.dim('  key not checked (--no-verify)')
  );
}
