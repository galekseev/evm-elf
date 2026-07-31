/**
 * Reading and editing profile files.
 *
 * Edits go through the YAML document API rather than a parse/stringify cycle so
 * that comments, key order and formatting of a hand-written profile survive.
 */

import { constants, existsSync } from 'fs';
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname } from 'path';
import chalk from 'chalk';
import { Document, isMap, parseDocument, type YAMLMap } from 'yaml';
import type { ChainConfig } from '../types.js';
import { BUNDLED_DEFAULT_PROFILE_PATH } from './env.js';

/** Field order used for chains this CLI writes */
const FIELD_ORDER = ['chain_id', 'rpc_url', 'symbol', 'coingecko_id', 'explorer_api'] as const;

/**
 * Copy the profile shipped with the package to the user config directory.
 * Never overwrites: a concurrent run that got there first wins.
 */
export async function ensureDefaultProfile(targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  try {
    await copyFile(BUNDLED_DEFAULT_PROFILE_PATH, targetPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return;
    }
    throw error;
  }
  console.error(chalk.dim(`Created ${targetPath} from the bundled default profile`));
}

/**
 * Parse a profile for editing, or start a new document when the file does not
 * exist yet. The 'chains' mapping is created if missing so that edits can
 * assume it is there.
 */
export async function readProfileDocument(filePath: string): Promise<Document> {
  const doc = existsSync(filePath)
    ? parseDocument(await readFile(filePath, 'utf-8'))
    : new Document({ chains: {} });

  const chains = doc.get('chains', true);
  if (!isMap(chains)) {
    if (chains !== null && chains !== undefined) {
      throw new Error(`Invalid profile ${filePath}: 'chains' must be a mapping`);
    }
    doc.set('chains', doc.createNode({}));
  }
  return doc;
}

function chainsMap(doc: Document): YAMLMap {
  const chains = doc.get('chains', true);
  if (!isMap(chains)) {
    throw new Error("Invalid profile: 'chains' must be a mapping");
  }
  return chains;
}

export function listChains(doc: Document): string[] {
  return Object.keys((chainsMap(doc).toJSON() ?? {}) as Record<string, unknown>);
}

/** Current values of a chain, as plain JS, or undefined when it is not there */
export function getChain(doc: Document, chain: string): ChainConfig | undefined {
  const entry = doc.getIn(['chains', chain], true);
  if (entry === undefined || entry === null) {
    return undefined;
  }
  if (!isMap(entry)) {
    // Pre-0.2 shorthand (`base: https://...`) carried only the RPC URL
    const value = doc.getIn(['chains', chain]);
    return typeof value === 'string' ? { rpc_url: value } : {};
  }
  return entry.toJSON() as ChainConfig;
}

export interface ChainEdit {
  chain_id?: number;
  rpc_url?: string;
  /** null clears the field */
  symbol?: string | null;
  coingecko_id?: string | null;
  explorer_api?: string | null;
  /** merged into the existing headers */
  headers?: Record<string, string>;
  removeHeaders?: string[];
}

/**
 * Add or update a chain. An existing mapping is edited in place so its comments
 * survive; anything else is replaced with a freshly built entry.
 */
export function setChain(doc: Document, chain: string, edit: ChainEdit): void {
  const chains = chainsMap(doc);
  const existing = doc.getIn(['chains', chain], true);

  if (!isMap(existing)) {
    chains.set(chain, doc.createNode(buildEntry(edit)));
    return;
  }

  for (const field of FIELD_ORDER) {
    const value = edit[field];
    if (value === undefined) {
      continue;
    }
    if (value === null || value === '') {
      existing.delete(field);
    } else {
      existing.set(field, doc.createNode(value));
    }
  }

  const headers = { ...(existing.toJSON() as ChainConfig).headers, ...edit.headers };
  for (const name of edit.removeHeaders ?? []) {
    delete headers[name];
  }
  if (Object.keys(headers).length === 0) {
    existing.delete('headers');
  } else {
    existing.set('headers', doc.createNode(headers));
  }
}

function buildEntry(edit: ChainEdit): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  for (const field of FIELD_ORDER) {
    const value = edit[field];
    if (value !== undefined && value !== null && value !== '') {
      entry[field] = value;
    }
  }
  const headers = { ...edit.headers };
  for (const name of edit.removeHeaders ?? []) {
    delete headers[name];
  }
  if (Object.keys(headers).length > 0) {
    entry.headers = headers;
  }
  return entry;
}

export function removeChain(doc: Document, chain: string): boolean {
  return chainsMap(doc).delete(chain);
}

/**
 * Write the document atomically with owner-only permissions: header values may
 * hold a literal API key.
 */
export async function writeProfileDocument(filePath: string, doc: Document): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    // lineWidth 0 keeps long RPC URLs on one line
    await writeFile(tmpPath, doc.toString({ lineWidth: 0 }), { mode: 0o600 });
    await rename(tmpPath, filePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}
