// Types mirror src/core/types.ts (kept in sync by hand; the API is the contract).
export type Agent = "claude-code" | "codex";
type TriFilter = "all" | "only" | "none";
type ArchivedFilter = TriFilter;
type ProgrammaticFilter = TriFilter;
type EventKind = "text" | "thinking" | "tool_use" | "tool_result" | "summary" | "system" | "hook" | "unknown";

interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number | null;
  unpricedModels: string[];
}

export interface Event {
  kind: EventKind;
  ts?: string;
  role?: string;
  text?: string;
  sidechain?: boolean;
  tool?: string;
  toolUseId?: string;
  input?: unknown;
  result?: { isError: boolean; text: string };
  hookEvent?: string;
  model?: string;
  usage?: Partial<Usage>;
  raw?: unknown;
  // Per-turn accounting attached by the server for events that carry usage.
  tokens?: number;
  cost?: number | null;
}

export interface SessionMeta {
  agent: Agent;
  id: string;
  path: string;
  cwd?: string;
  title: string;
  messages: number;
  started?: string;
  ended?: string;
  mtime: number;
  gitBranch?: string;
  model?: string;
  models?: string[];
  version?: string;
  archived?: boolean;
  imported?: boolean;
  importedFrom?: string;
  programmatic?: boolean;
  origin?: string;
  isSubagent?: boolean;
  parentId?: string;
  agentName?: string;
  spawnedByToolUseId?: string;
}

export interface Session extends SessionMeta {
  events: Event[];
  usage?: Usage;
}

export interface SessionHit {
  agent: Agent;
  sessionId: string;
  path: string;
  cwd?: string;
  title: string;
  ts?: string;
  mtime: number;
  models?: string[];
  archived?: boolean;
  imported?: boolean;
  importedFrom?: string;
  programmatic?: boolean;
  origin?: string;
  isSubagent?: boolean;
  parentId?: string;
  agentName?: string;
  matchCount: number;
  snippet: string;
}

export interface Filters {
  q: string;
  agents: Agent[];
  tools: string[];
  models: string[];
  cwds: string[];
  since: string;
  until: string;
  kinds: EventKind[];
  mask: boolean;
  /** Restrict to one imported collection (its name), or "" for every source. An
   *  orthogonal scope, not a content filter — set via the header source switcher. */
  source: string;
  /** Treat archived sessions: all (default) | only | none. */
  archived: ArchivedFilter;
  /** Treat programmatic (SDK-driven) sessions: all (default) | only | none. */
  programmatic: ProgrammaticFilter;
}

function qs(params: Record<string, string | string[] | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => x && sp.append(k, x));
    else if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? "?" + s : "";
}

export async function apiFacets(): Promise<{ tools: string[]; cwds: string[]; models: string[] }> {
  const r = await fetch("/api/facets");
  return r.json();
}

/** The imported collections (one per synced person/machine) with a count each. */
export async function apiSources(): Promise<{ name: string; count: number }[]> {
  const r = await fetch("/api/sources");
  return r.json();
}

export async function apiSessions(f: Partial<Filters>): Promise<SessionMeta[]> {
  const r = await fetch(
    "/api/sessions" +
      qs({
        agent: f.agents?.join(","),
        project: f.cwds,
        model: f.models,
        source: f.source || undefined,
        archived: f.archived && f.archived !== "all" ? f.archived : undefined,
        programmatic: f.programmatic && f.programmatic !== "all" ? f.programmatic : undefined,
      }),
  );
  return r.json();
}

export async function apiSession(agent: Agent, id: string, mask: boolean): Promise<Session> {
  const r = await fetch("/api/session" + qs({ agent, id, mask: mask ? "1" : "0" }));
  return r.json();
}

export async function apiSearch(f: Filters, limit: number): Promise<SessionHit[]> {
  const r = await fetch(
    "/api/search" +
      qs({
        q: f.q,
        agent: f.agents.join(","),
        tool: f.tools,
        model: f.models,
        cwd: f.cwds,
        source: f.source || undefined,
        since: f.since,
        until: f.until,
        kind: f.kinds.join(","),
        mask: f.mask ? "1" : "0",
        archived: f.archived && f.archived !== "all" ? f.archived : undefined,
        programmatic: f.programmatic && f.programmatic !== "all" ? f.programmatic : undefined,
        limit: String(limit),
      }),
  );
  return r.json();
}

/** Download a bundle of native sessions (for cross-machine sync). With `filters`,
 *  the server re-runs them unbounded and exports only the matching sessions;
 *  without, the whole machine. */
export async function apiExport(filters?: Filters): Promise<Blob> {
  const r = await fetch("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(filters ? { filters } : {}),
  });
  if (!r.ok) throw new Error("export failed");
  return r.blob();
}

/** Import destination: the view-only agtail store (audit) or the real agent dirs
 *  (machine migration). */
export type ImportMode = "agtail" | "native";

/** Upload a bundle. `mode` chooses the destination; `overwrite` replaces existing
 *  files (else they're skipped, i.e. append-only). */
export async function apiImport(
  bundleText: string,
  opts: { mode: ImportMode; overwrite: boolean; collection?: string },
): Promise<{ written: number; skipped: number }> {
  const params = qs({
    mode: opts.mode,
    overwrite: opts.overwrite ? "1" : "0",
    collection: opts.mode === "agtail" ? opts.collection || undefined : undefined,
  });
  const r = await fetch("/api/import" + params, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: bundleText,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error ?? "import failed");
  return data;
}
