import { join, sep } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import type { Agent } from "./types.js";

// agtail keeps imported (synced-from-another-machine) sessions in its own store,
// outside the native agent dirs, so they never masquerade as local history the
// agent could resume. Imports are grouped into named *collections* —
// imported/<collection>/<agent>/… — so several people's or machines' histories
// stay distinct (e.g. an auditor reviewing many sources can switch between them).
//
// Resolved lazily (read at call time, not module load) so a test can point
// XDG_DATA_HOME at a tmp dir without reimporting — same pattern as pricing.ts.
function storeBase(): string {
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}

/** Root holding every imported collection: <store>/agtail/imported/. */
function importStoreRoot(): string {
  return join(storeBase(), "agtail", "imported");
}

/** A named collection's per-agent dir: imported/<collection>/<agent>. */
export function collectionDir(collection: string, agent: Agent): string {
  return join(importStoreRoot(), collection, agent);
}

/** The collection name an absolute path belongs to (its first segment under the
 *  store root), or undefined if the path isn't inside the import store. */
export function collectionOf(path: string): string | undefined {
  const root = importStoreRoot();
  if (path !== root && !path.startsWith(root + sep)) return undefined;
  return path.slice(root.length + 1).split(sep)[0] || undefined;
}

/** Names of all existing import collections (directories under the store root). */
export function listCollections(): string[] {
  const root = importStoreRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Longest collection name we accept, counted in Unicode code points. Names
 *  become a single filesystem path component, so even at UTF-8's worst case of
 *  4 bytes/char this stays at 160 bytes — well under the common 255-byte
 *  NAME_MAX limit, so we can cap by character count rather than bytes. */
const COLLECTION_NAME_MAX = 40;

/** Reject a collection name that isn't a single safe path segment, so an
 *  untrusted import can't escape the store via separators or `..`. Letters and
 *  digits of any language are allowed (e.g. Japanese); NFC-normalized so the
 *  name round-trips through the filesystem regardless of input method. */
export function sanitizeCollection(name: string): string {
  const trimmed = name.trim().normalize("NFC");
  if (!trimmed || trimmed === "." || trimmed === ".." || !/^[\p{L}\p{N}._-]+$/u.test(trimmed)) {
    throw new Error(`invalid collection name: ${JSON.stringify(name)} (use letters, digits, and . _ -)`);
  }
  const length = [...trimmed].length;
  if (length > COLLECTION_NAME_MAX) {
    throw new Error(`collection name too long: ${length} chars (max ${COLLECTION_NAME_MAX})`);
  }
  return trimmed;
}
