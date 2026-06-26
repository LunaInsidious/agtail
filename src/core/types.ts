// Normalized model shared across agents. Each adapter (Claude Code, Codex, …)
// maps its own transcript format into these shapes so the rest of agtail —
// search, CLI, server, web — is agent-agnostic.

export type Agent = "claude-code" | "codex";

export const AGENTS: Agent[] = ["claude-code", "codex"];

/** A tri-state filter over a boolean session attribute: include all, only the
 *  ones with it, or exclude them. Default everywhere is "all". */
export type TriFilter = "all" | "only" | "none";
export type ArchivedFilter = TriFilter;
export type AutomatedFilter = TriFilter;

function matchTri(value: boolean | undefined, f?: TriFilter): boolean {
  if (f === "only") return Boolean(value);
  if (f === "none") return !value;
  return true;
}

/** Whether a session passes an archived filter (default "all" => everything). */
export const matchArchived = (m: { archived?: boolean }, f?: ArchivedFilter) => matchTri(m.archived, f);

/** Whether a session passes an automated filter (default "all" => everything). */
export const matchAutomated = (m: { automated?: boolean }, f?: AutomatedFilter) => matchTri(m.automated, f);

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
  | "hook"
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

  // kind === "hook": the lifecycle event it fired on (SessionStart, PreToolUse,
  // PostToolUse, Stop, …) — used to group/toggle hooks by type.
  hookEvent?: string;

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
  // Primary (first-seen) model, kept for back-compat. `models` is the full set.
  model?: string;
  // Distinct models the session used, in first-seen order. More than one means
  // the model was switched mid-session; the header shows them joined with "→".
  models?: string[];
  version?: string;

  // True when the agent has set this session aside (Codex moves finished threads
  // to archived_sessions/). Orthogonal to agent — an archived session is still a
  // normal codex session, just out of the agent's active resume picker.
  archived?: boolean;

  // Machine-driven session (launched via the Agent SDK rather than the
  // interactive CLI/TUI) — hooks, scripts, headless review agents. Lets the UI
  // de-emphasize/filter automated noise from a human-history view.
  automated?: boolean;
  // The raw launch identifier behind `automated`, for a human-readable label:
  // Claude's entrypoint ("sdk-py"/"sdk-ts") or Codex's originator. The
  // transcript records HOW it was launched, not which specific tool/plugin.
  origin?: string;

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
  models?: string[];
  archived?: boolean;
  automated?: boolean;
  origin?: string;
  matchCount: number;
  snippet: string; // first matching event's snippet
}
