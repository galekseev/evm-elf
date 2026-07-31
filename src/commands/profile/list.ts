/**
 * profile list command - the profiles on this machine and which one is default
 */

import chalk from 'chalk';
import type { ProfileListOptions } from '../../types.js';
import { resolveDefaultProfile, type DefaultProfile } from '../../lib/env.js';
import { loadProfile, resolveProfileTarget } from '../../lib/chains.js';
import { listProfileFiles } from '../../lib/profiles.js';

const COL = {
  marker: 2,
  profile: 20,
  chains: 8,
} as const;

function legend(active: DefaultProfile): string {
  switch (active.source) {
    case 'env':
      return `* in use: ${active.name} (from $EVM_ELF_PROFILE)`;
    case 'pointer':
      return `* in use: ${active.name} (set by evm profile set-default)`;
    default:
      return `* in use: ${active.name} (built-in default; change it with evm profile set-default <name>)`;
  }
}

interface ProfileSummary {
  name: string;
  path: string;
  chains?: number;
  default: boolean;
  error?: string;
}

export async function profileListCommand(options: ProfileListOptions): Promise<void> {
  // Seeds the default profile, so a fresh machine does not show an empty list
  const target = await resolveProfileTarget();
  const active = resolveDefaultProfile();

  const summaries: ProfileSummary[] = [];
  for (const file of await listProfileFiles()) {
    const summary: ProfileSummary = {
      name: file.name,
      path: file.path,
      default: file.path === target.path,
    };
    try {
      summary.chains = Object.keys((await loadProfile(file.path)).chains).length;
    } catch (error) {
      summary.error = (error as Error).message;
    }
    summaries.push(summary);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        { default: active.name, source: active.source, profiles: summaries },
        null,
        2
      )
    );
    return;
  }

  console.log();
  if (summaries.length === 0) {
    console.log(chalk.dim('No profiles yet. Create one: evm profile create myproject'));
    console.log();
    return;
  }

  const pathWidth = Math.max(...summaries.map((summary) => summary.path.length));
  const header =
    [' '.repeat(COL.marker), 'Profile'.padEnd(COL.profile), 'Chains'.padEnd(COL.chains)].join(' ') +
    ' Path';
  console.log(header);
  console.log('─'.repeat(COL.marker + COL.profile + COL.chains + 3 + pathWidth));

  for (const summary of summaries) {
    const marker = summary.default ? chalk.green('*'.padEnd(COL.marker)) : ' '.repeat(COL.marker);
    const name = summary.default
      ? chalk.bold(summary.name.padEnd(COL.profile))
      : summary.name.padEnd(COL.profile);
    const chains = summary.error
      ? chalk.red('error'.padEnd(COL.chains))
      : chalk.cyan(String(summary.chains).padEnd(COL.chains));
    console.log([marker, name, chains, chalk.dim(summary.path)].join(' '));
    if (summary.error) {
      console.log(`${' '.repeat(COL.marker + COL.profile + 2)} ${chalk.red(summary.error)}`);
    }
  }

  console.log();
  if (summaries.some((summary) => summary.default)) {
    console.log(chalk.dim(legend(active)));
  } else {
    console.log(chalk.yellow(`Default profile '${active.name}' is missing: ${target.path}`));
  }
  console.log();
}
