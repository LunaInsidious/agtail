// Normalized model shared across agents. Each adapter (Claude Code, Codex, …)
// maps its own transcript format into these shapes so the rest of agtail —
// search, CLI, server, web — is agent-agnostic.

export type Agent = "claude-code" | "codex";

export const AGENTS: Agent[] = ["claude-code", "codex"];

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
  snippet: string;
}
