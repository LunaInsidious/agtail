// Normalized model shared across agents. Each adapter (Claude Code, Codex, …)
// maps its own transcript format into these shapes so the rest of agtail —
// search, CLI, server, web — is agent-agnostic.

export type Agent = "claude-code" | "codex";

export const AGENTS: Agent[] = ["claude-code", "codex"];

/** Type guard for {@link Agent}, so a parsed string list narrows to Agent[]
 *  via `.filter(isAgent)` without a cast. */
export function isAgent(v: unknown): v is Agent {
  return v === "claude-code" || v === "codex";
}

/** A tri-state filter over a boolean session attribute: include all, only the
 *  ones with it, or exclude them. Default everywhere is "all". */
export type TriFilter = "all" | "only" | "none";
export type ArchivedFilter = TriFilter;
export type ProgrammaticFilter = TriFilter;

function matchTri(value: boolean | undefined, f?: TriFilter): boolean {
  if (f === "only") return Boolean(value);
  if (f === "none") return !value;
  return true;
}

/** Whether a session passes an archived filter (default "all" => everything). */
export const matchArchived = (m: { archived?: boolean }, f?: ArchivedFilter) => matchTri(m.archived, f);

/** Whether a session passes a programmatic filter (default "all" => everything). */
export const matchProgrammatic = (m: { programmatic?: boolean }, f?: ProgrammaticFilter) => matchTri(m.programmatic, f);

// Sentinel `source` value selecting only this machine's own (non-imported)
// sessions. The "@" can't appear in a sanitized collection name, so it never
// collides with a real source. (Mirrored as a literal in the web layer.)
export const LOCAL_SOURCE = "@local";

/** Whether a session passes a source filter: "" = any, LOCAL_SOURCE = only
 *  this machine's, else a specific imported collection. */
export const matchSource = (m: { imported?: boolean; importedFrom?: string }, source?: string): boolean =>
  !source || (source === LOCAL_SOURCE ? !m.imported : m.importedFrom === source);

/** Token usage for one assistant turn (fields optional; agents differ). */
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export type EventKind = "text" | "thinking" | "tool_use" | "tool_result" | "summary" | "system" | "hook" | "unknown";

const EVENT_KINDS: ReadonlySet<string> = new Set([
  "text",
  "thinking",
  "tool_use",
  "tool_result",
  "summary",
  "system",
  "hook",
  "unknown",
]);

/** Type guard for {@link EventKind}, so a parsed comma list narrows to
 *  EventKind[] via `.filter(isEventKind)` without a cast. */
export function isEventKind(v: unknown): v is EventKind {
  return typeof v === "string" && EVENT_KINDS.has(v);
}

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
  // The hook's configured command (from the transcript), and the plugin it
  // belongs to. `plugin` is resolved at display time by matching `command`
  // against the locally-installed plugins (see core/plugins.ts) — so it's only
  // present for sessions whose plugins are installed on this machine.
  command?: string;
  plugin?: string;

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

  // True when the session lives in agtail's own import store (synced in from
  // another machine) rather than the native agent dirs. Orthogonal to agent.
  imported?: boolean;
  // The named import collection it came from (one per synced person/machine), so
  // imported histories can be told apart and switched between.
  importedFrom?: string;

  // Machine-driven session (launched via the Agent SDK rather than the
  // interactive CLI/TUI) — hooks, scripts, headless review agents. Lets the UI
  // de-emphasize/filter programmatic noise from a human-history view.
  programmatic?: boolean;
  // The raw launch identifier behind `programmatic`, for a human-readable label:
  // Claude's entrypoint ("sdk-py"/"sdk-ts") or Codex's originator. The
  // transcript records HOW it was launched, not which specific tool/plugin.
  origin?: string;
  // For an SDK-spawned session: the plugin that launched it, inferred at display
  // time by matching the session's prompt to that plugin's review-prompt template
  // (the transcript records no direct link). Local installs only; see plugins.ts.
  spawnedBy?: string;

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
  imported?: boolean;
  importedFrom?: string;
  programmatic?: boolean;
  origin?: string;
  spawnedBy?: string; // plugin behind an SDK-spawned session (attached by the API)
  // Subagent linkage, so search results can nest a matched child under its
  // matched parent (and show an unmatched-parent child standalone).
  isSubagent?: boolean;
  parentId?: string;
  agentName?: string;
  matchCount: number;
  snippet: string; // first matching event's snippet
}
