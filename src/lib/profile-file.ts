/**
 * Reading and editing the chains inside one profile file.
 *
 * Edits go through the YAML document API rather than a parse/stringify cycle so
 * that comments, key order and formatting of a hand-written profile survive.
 * Operations on the set of profiles live in profiles.ts.
 */

import { existsSync } from 'fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { Document, isMap, parseDocument, type YAMLMap } from 'yaml';
import type { ChainConfig } from '../types.js';

/** Field order used for chains this CLI writes */
const FIELD_ORDER = ['chain_id', 'rpc_url', 'symbol', 'coingecko_id', 'explorer_api'] as const;

/**
 * Parse a profile for editing. The 'chains' mapping is created if missing so
 * that edits can assume it is there.
 *
 * A missing file yields an empty document rather than an error, so callers must
 * check that the profile exists first: only the default profile is created on
 * demand, and a -p naming anything else has to fail rather than write a new one.
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
 * The explorers section, or undefined when there is none. Created on demand
 * above 'chains': it is two lines long, and a reader should not have to scroll
 * past every chain to find it.
 */
function explorersMap(doc: Document, create: boolean): YAMLMap | undefined {
  const explorers = doc.get('explorers', true);
  if (isMap(explorers)) {
    return explorers;
  }
  if (explorers !== null && explorers !== undefined) {
    throw new Error("Invalid profile: 'explorers' must be a mapping");
  }
  if (!create) {
    return undefined;
  }
  const contents = doc.contents;
  if (isMap(contents)) {
    contents.items.unshift(doc.createPair('explorers', {}));
  } else {
    doc.set('explorers', doc.createNode({}));
  }
  return doc.get('explorers', true) as YAMLMap;
}

/** Configured API keys as written, with ${VAR} references left unresolved */
export function getExplorers(doc: Document): Record<string, string> {
  const explorers = doc.get('explorers', true);
  if (!isMap(explorers)) {
    return {};
  }
  const raw = (explorers.toJSON() ?? {}) as Record<string, unknown>;
  const configured: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value !== '') {
      configured[name] = value;
    }
  }
  return configured;
}

export function setExplorer(doc: Document, name: string, apiKey: string): void {
  explorersMap(doc, true)?.set(name, doc.createNode(apiKey));
}

export function removeExplorer(doc: Document, name: string): boolean {
  return explorersMap(doc, false)?.delete(name) ?? false;
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
