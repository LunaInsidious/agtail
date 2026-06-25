// Normalized model shared across agents. Each adapter (Claude Code, Codex, …)
// maps its own transcript format into these shapes so the rest of agtail —
// search, CLI, server, web — is agent-agnostic.

export type Agent = "claude-code" | "codex";

export const AGENTS: Agent[] = ["claude-code", "codex"];

/** How a listing/search treats archived sessions: include all, only archived,
 *  or exclude archived. Default everywhere is "all". */
export type ArchivedFilter = "all" | "only" | "none";

/** Whether a session passes an archived filter (default "all" => everything). */
export function matchArchived(m: { archived?: boolean }, f?: ArchivedFilter): boolean {
  if (f === "only") return Boolean(m.archived);
  if (f === "none") return !m.archived;
  return true;
}

/** Token usage for one assistant turn (fields optional; agents differ). */
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export type EventKind =
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "summary"
  | "system"
  | "unknown";

/** One normalized timeline event. tool_result is merged into its tool_use. */
export interface Event {
  kind: EventKind;
  ts?: string; // ISO 8601
  role?: string; // "user" | "assistant" | "developer" | "system" | ...
  text?: string;
  sidechain?: boolean;

  // tool_use
  tool?: string;
  toolUseId?: string;
  input?: unknown;
  result?: { isError: boolean; text: string };

  // assistant accounting (used by cost aggregation)
  model?: string;
  usage?: Usage;

  // kind === "unknown": preserve the raw record rather than dropping it.
  raw?: unknown;
}

/** Lightweight session descriptor for listings and search indexing. */
export interface SessionMeta {
  agent: Agent;
  id: string;
  path: string;
  cwd?: string;
  title: string;
  messages: number;
  started?: string;
  ended?: string;
  mtime: number; // ms epoch, for sorting
  gitBranch?: string;
  model?: string;
  version?: string;

  // True when the agent has set this session aside (Codex moves finished threads
  // to archived_sessions/). Orthogonal to agent — an archived session is still a
  // normal codex session, just out of the agent's active resume picker.
  archived?: boolean;

  // Subagent (sidechain) linkage. A subagent transcript is a child of the
  // session that spawned it via a Task tool call.
  isSubagent?: boolean;
  parentId?: string; // id of the spawning (parent) session
  agentName?: string; // e.g. "Explore", "general-purpose"
  spawnedByToolUseId?: string; // the parent's Task tool_use id
}

/** A fully-read session with its normalized events. */
export interface Session extends SessionMeta {
  events: Event[];
}

/** A single search hit. */
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

/** A search result grouped to one entry per matching session (for the web Hits
 *  list). Carries a representative snippet + how many events matched. */
export interface SessionHit {
  agent: Agent;
  sessionId: string;
  path: string;
  cwd?: string;
  title: string;
  ts?: string; // last event time, for display
  mtime: number;
  archived?: boolean;
  matchCount: number;
  snippet: string; // first matching event's snippet
}
