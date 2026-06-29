import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Agent } from "./types.js";
import { AGENTS, isAgent } from "./types.js";
import type { RootOverrides } from "./adapters/types.js";
import { selectAdapters } from "./adapters/index.js";
import { isRecord } from "./utils.js";
import { collectionDir, sanitizeCollection } from "./imported.js";

// A portable bundle of raw transcripts: enough to rehydrate sessions on another
// machine. Files carry their content inline plus a base-relative path so import
// can place them either back into the native agent dirs or the agtail store.
export interface Bundle {
  agtailExport: 1;
  created: string;
  files: { agent: Agent; rel: string; content: string }[];
}

/** A session the caller wants exported, identified by the same agent + path the
 *  list/search API returns. Used to narrow a full export down to a chosen subset. */
interface ExportRef {
  agent: Agent;
  path: string;
}

interface ExportOptions {
  /** Limit to these agents (default: all). */
  agents?: Agent[];
  /** Limit to these sessions (default: every native transcript). A sibling
   *  `.meta.json` travels with its selected transcript automatically. */
  selection?: ExportRef[];
}

/** Build a predicate over an adapter's enumerated files. A file is kept only if
 *  it (or, for a sidecar meta, its transcript) is in the selection — so we never
 *  read an arbitrary caller-supplied path, only intersect with `transferFiles`. */
function selectionFilter(selection: ExportRef[]): (agent: Agent, file: string) => boolean {
  const want = new Set(selection.map((s) => `${s.agent}\0${s.path}`));
  const has = (agent: Agent, file: string) => want.has(`${agent}\0${file}`);
  return (agent, file) =>
    has(agent, file) || (file.endsWith(".meta.json") && has(agent, file.replace(/\.meta\.json$/, ".jsonl")));
}

/** Collect native transcripts from the selected agents into a portable bundle.
 *  `rel` is each file's path relative to that agent's base dir. With no
 *  `selection`, every transcript is bundled; with one, only the chosen subset. */
export async function exportSessions(opts: ExportOptions = {}, overrides?: RootOverrides): Promise<Bundle> {
  const adapters = selectAdapters(opts.agents, overrides);
  const keep = opts.selection ? selectionFilter(opts.selection) : undefined;
  const fileLists = await Promise.all(
    adapters.map(async (a) => {
      const paths = await a.transferFiles();
      const chosen = keep ? paths.filter((file) => keep(a.agent, file)) : paths;
      return Promise.all(
        chosen.map(async (file) => ({
          agent: a.agent,
          rel: relative(a.base, file),
          content: await readFile(file, "utf-8"),
        })),
      );
    }),
  );
  return { agtailExport: 1, created: new Date().toISOString(), files: fileLists.flat() };
}

interface ImportOpts {
  mode: "native" | "agtail";
  overwrite: boolean;
  /** Collection name for mode "agtail" (groups this import; default "imported").
   *  Ignored for "native". */
  collection?: string;
}

/** Validate untrusted bundle JSON, throwing a clear Error on any shape mismatch
 *  so callers (CLI) can surface it rather than writing garbage to disk. */
export function assertBundle(value: unknown): asserts value is Bundle {
  if (!isRecord(value) || value.agtailExport !== 1) {
    throw new Error("not an agtail export bundle (agtailExport !== 1)");
  }
  if (!Array.isArray(value.files)) throw new Error("bundle.files must be an array");
  for (const f of value.files) {
    if (!isRecord(f) || typeof f.agent !== "string" || typeof f.rel !== "string" || typeof f.content !== "string") {
      throw new Error("bundle.files entries must have string agent/rel/content");
    }
    if (!isAgent(f.agent)) throw new Error(`bundle.files has unknown agent: ${f.agent}`);
  }
}

/** A resolved destination is safe only if it stays inside its base dir — a
 *  bundle is untrusted, so a `rel` that escapes via `..` must never be written. */
function withinBase(base: string, dest: string): boolean {
  const b = resolve(base);
  const d = resolve(dest);
  return d === b || d.startsWith(b + sep);
}

/** Write a bundle's files to disk. mode "native" restores into the local agent
 *  dirs; mode "agtail" places them in the agtail import store. Path-traversal
 *  entries and (unless overwrite) existing files are skipped, not written. */
export async function importSessions(
  bundle: Bundle,
  opts: ImportOpts,
  overrides?: RootOverrides,
): Promise<{ written: number; skipped: number }> {
  assertBundle(bundle);
  const baseFor = baseResolver(opts.mode, overrides, opts.collection);
  const count = { written: 0, skipped: 0 };
  for (const file of bundle.files) {
    const destBase = baseFor(file.agent);
    const dest = join(destBase, file.rel);
    if (!withinBase(destBase, dest)) {
      count.skipped++; // rejected path traversal — never write outside the base
      continue;
    }
    if (!opts.overwrite && existsSync(dest)) {
      count.skipped++;
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.content);
    count.written++;
  }
  return count;
}

/** Resolve each agent's destination base for the chosen import mode. For native,
 *  use the local adapter's base (honoring --dir overrides); the map always has
 *  every agent (selectAdapters(AGENTS) builds all of them). */
function baseResolver(
  mode: "native" | "agtail",
  overrides?: RootOverrides,
  collection?: string,
): (agent: Agent) => string {
  if (mode === "agtail") {
    const col = sanitizeCollection(collection ?? "imported");
    return (agent) => collectionDir(col, agent);
  }
  const nativeBase = new Map(selectAdapters(AGENTS, overrides).map((a) => [a.agent, a.base]));
  return (agent) => {
    const base = nativeBase.get(agent);
    if (base === undefined) throw new Error(`no adapter for agent: ${agent}`);
    return base;
  };
}
