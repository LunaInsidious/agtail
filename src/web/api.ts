// Types mirror src/core/types.ts (kept in sync by hand; the API is the contract).
export type Agent = "claude-code" | "codex";
export type TriFilter = "all" | "only" | "none";
export type ArchivedFilter = TriFilter;
export type AutomatedFilter = TriFilter;
export type EventKind =
  | "text" | "thinking" | "tool_use" | "tool_result" | "summary" | "system" | "hook" | "unknown";

export interface Usage {
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
  version?: string;
  archived?: boolean;
  automated?: boolean;
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

export interface Match {
  agent: Agent;
  sessionId: string;
  path: string;
  ts?: string;
  kind: EventKind;
  tool?: string;
  cwd?: string;
  archived?: boolean;
  snippet: string;
}

export interface SessionHit {
  agent: Agent;
  sessionId: string;
  path: string;
  cwd?: string;
  title: string;
  ts?: string;
  mtime: number;
  archived?: boolean;
  automated?: boolean;
  origin?: string;
  matchCount: number;
  snippet: string;
}

export interface Filters {
  q: string;
  agents: Agent[];
  tools: string[];
  cwd: string;
  since: string;
  until: string;
  kinds: EventKind[];
  mask: boolean;
  /** Treat archived sessions: all (default) | only | none. */
  archived: ArchivedFilter;
  /** Treat automated (SDK-driven) sessions: all (default) | only | none. */
  automated: AutomatedFilter;
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

export async function apiFacets(): Promise<{ tools: string[]; cwds: string[] }> {
  const r = await fetch("/api/facets");
  return r.json();
}

export async function apiSessions(f: Partial<Filters>): Promise<SessionMeta[]> {
  const r = await fetch(
    "/api/sessions" +
      qs({
        agent: f.agents?.join(","),
        project: f.cwd,
        archived: f.archived && f.archived !== "all" ? f.archived : undefined,
        automated: f.automated && f.automated !== "all" ? f.automated : undefined,
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
        cwd: f.cwd,
        since: f.since,
        until: f.until,
        kind: f.kinds.join(","),
        mask: f.mask ? "1" : "0",
        archived: f.archived && f.archived !== "all" ? f.archived : undefined,
        automated: f.automated && f.automated !== "all" ? f.automated : undefined,
        limit: String(limit),
      }),
  );
  return r.json();
}
