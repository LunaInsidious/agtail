/// <reference types="vite/client" />
import type { Agent, Session } from "../../core/types.js";
import { buildClaudeSession } from "../../core/adapters/claude-code.js";
import { buildCodexSession } from "../../core/adapters/codex.js";
import { parseJsonlText } from "../../core/jsonl-parse.js";
import { isRecord } from "../../core/utils.js";

// The playground's data layer. The fictional sample transcripts are inlined at
// build time (no fs, no server); imports add parsed sessions to an in-memory
// store that lives only for the page's lifetime (closing the tab frees it).

// Raw transcript text, inlined by Vite. Keys are like "./sample/<id>.jsonl".
const RAW = import.meta.glob("./sample/**/*.jsonl", { query: "?raw", import: "default", eager: true });
const METAS = import.meta.glob("./sample/**/*.meta.json", { query: "?raw", import: "default", eager: true });

const asText = (v: unknown): string => (typeof v === "string" ? v : "");
const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const stem = (path: string): string => baseName(path).replace(/\.jsonl$/, "");
const isCodex = (path: string): boolean => baseName(path).startsWith("rollout-");
const isSubagent = (path: string): boolean => path.includes("/subagents/");

/** A session's mtime: the real fs adapter uses the file mtime; here we use the
 *  last event timestamp so "newest first" ordering is meaningful and stable. */
const mtimeOf = (s: Session): number => Date.parse(s.ended ?? s.started ?? "") || 0;

/** The subagent descriptor from a sibling .meta.json, shaped like the fs
 *  adapter's (agentType -> agentName), with parentId taken from the path. */
function subagentInfo(jsonlPath: string) {
  const parentId =
    jsonlPath
      .replace(/\/subagents\/.*$/, "")
      .split("/")
      .pop() ?? "";
  const metaText = asText(METAS[jsonlPath.replace(/\.jsonl$/, ".meta.json")]);
  const parsed: unknown = metaText ? JSON.parse(metaText) : {};
  const m: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  return {
    parentId,
    agentName: typeof m.agentType === "string" ? m.agentType : undefined,
    description: typeof m.description === "string" ? m.description : undefined,
    toolUseId: typeof m.toolUseId === "string" ? m.toolUseId : undefined,
  };
}

function parseSample(path: string, content: string): Session {
  const lines = parseJsonlText(content);
  if (isCodex(path)) return withMtime(buildCodexSession(lines, { id: stem(path), path, mtime: 0 }));
  const subagent = isSubagent(path) ? subagentInfo(path) : undefined;
  return withMtime(buildClaudeSession(lines, { id: stem(path), path, mtime: 0, subagent }));
}

const withMtime = (s: Session): Session => ({ ...s, mtime: mtimeOf(s) });

const NATIVE: Session[] = Object.entries(RAW).map(([path, content]) => parseSample(path, asText(content)));

/** Raw files eligible for export — the top-level sample sessions (claude main +
 *  codex), not subagent transcripts (they travel with their parent in the real
 *  app; the playground keeps export/import to standalone sessions). */
export const nativeFiles: { agent: Agent; path: string; rel: string; content: string }[] = Object.entries(RAW)
  .filter(([path]) => !isSubagent(path))
  .map(([path, content]) => ({
    agent: isCodex(path) ? "codex" : "claude-code",
    path,
    rel: baseName(path),
    content: asText(content),
  }));

// Imported sessions live here for the page's lifetime only (memory, not IndexedDB
// — a visitor's multi-GB bundle leaves no lasting footprint on their machine).
const store: { imported: Session[] } = { imported: [] };

export const allSessions = (): Session[] => [...NATIVE, ...store.imported];
export const importedSessions = (): Session[] => store.imported;
export const addImported = (sessions: Session[]): void => {
  store.imported.push(...sessions);
};
export const findByPath = (path: string): Session | undefined => allSessions().find((s) => s.path === path);
export const idsInCollection = (collection: string): Set<string> =>
  new Set(store.imported.filter((s) => s.importedFrom === collection).map((s) => s.id));
