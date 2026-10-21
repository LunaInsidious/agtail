// Normalized model shared across agents. Each adapter (Claude Code, Codex, …)
// maps its own transcript format into these shapes so the rest of agtail —
// search, CLI, server, web — is agent-agnostic.

// An agent id. Open string: the built-in adapters use "claude-code"/"codex", and
// new agents are added as more in-tree adapters (see core/adapters/register-node.ts).
// Validation is registry-driven — the set of valid agents is whatever adapters are
// registered (see adapters/registeredAgents), not a fixed union.
export type Agent = string;

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

/** A child session launched from an event — possibly in another agent (a
 *  Claude Code hook running `codex exec`). */
interface SpawnedSession {
  id: string;
  agent: Agent;
  inferred?: boolean;
}

/** When and where a hook ran. */
interface HookRun {
  start: string;
  end: string;
  cwd: string;
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
  // A one-line presentation summary of `input`, attached at display time by the
  // API/CLI (via the agent's adapter describeTool, or the core fallback) — NOT
  // set by normalization. Lets the browser render agent-specific tools it can't summarize.
  toolSummary?: string;

  // kind === "text": this event is a context-compaction summary — the agent
  // condensed its own context at this point, so fine detail before it is lost to
  // everything downstream. (Claude records it as isCompactSummary.)
  compactBoundary?: boolean;

  // kind === "hook": the lifecycle event it fired on (SessionStart, PreToolUse,
  // PostToolUse, Stop, …) — used to group/toggle hooks by type.
  hookEvent?: string;
  // The hook's configured command (from the transcript), and the plugin it
  // belongs to. `plugin` is resolved at display time by matching `command`
  // against the locally-installed plugins (see core/plugins.ts) — so it's only
  // present for sessions whose plugins are installed on this machine.
  command?: string;
  plugin?: string;
  // A hook firing's run window (ISO start/end) and the directory it ran in,
  // when the agent records them. Adapter-normalized so core never reads raw
  // records; hook-spawn lineage is inferred from it (see core/lineage.ts).
  hookRun?: HookRun;

  // Sessions this event launched (a subagent spawn call, or a hook that started
  // a headless session). Lets the timeline link parent -> child at the exact
  // point of spawn. `inferred` marks a link reconstructed from timing rather
  // than recorded by the agent (see core/lineage.ts).
  spawnedSessions?: SpawnedSession[];

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

  // Transcript integrity signals for line-oriented (JSONL) transcripts. Set ONLY
  // when non-clean, so their absence means "clean" and existing callers/tests are
  // unaffected. A forensic caveat that the on-disk record is imperfect — surfaced
  // as a reading aid, not a filter dimension.
  //   malformedLines — count of non-empty lines that failed to parse and were
  //                    dropped during read (mid-file corruption).
  //   truncated      — the final non-empty line failed to parse: a strong signal
  //                    the file was cut mid-write (an interrupted/killed session).
  malformedLines?: number;
  truncated?: boolean;

  // How the session ended, set ONLY when non-normal (absence = normal/unknown,
  // same positive-signal convention as the integrity fields). A forensic reading
  // aid — not a filter dimension — derived from what each format actually records:
  //   "interrupted" — a turn started but never completed: the session was cut
  //                   mid-turn (Codex: a task_started with no task_complete).
  //   "limit"       — the final turn hit the model's output-token cap (Claude:
  //                   stop_reason "max_tokens").
  termination?: "interrupted" | "limit";
  // Number of context-compaction boundaries in the session (set only when > 0).
  // Each marks a point where the agent condensed its context — detail is lost to
  // everything after it, which often explains later "it forgot X" behaviour.
  compactions?: number;

  // Subagent (sidechain) linkage. A subagent transcript is a child of the
  // session that spawned it via a Task tool call.
  isSubagent?: boolean;
  parentId?: string; // id of the spawning (parent) session
  agentName?: string; // e.g. "Explore", "general-purpose"
  spawnedByToolUseId?: string; // the parent's Task tool_use id
  // True when `parentId` was inferred rather than recorded: a hook-launched SDK
  // session linked to the session whose hook was running when it started (see
  // core/lineage.ts). Set only alongside parentId; absent = recorded (subagent).
  parentInferred?: boolean;
  // The parent's agent, set alongside an inferred parentId: a hook in one agent
  // can launch another agent's session. A recorded parent is always same-agent.
  parentAgent?: Agent;
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
  parentInferred?: boolean;
  agentName?: string;
  matchCount: number;
  snippet: string; // first matching event's snippet
}
