# Adapters & the normalized model

agtail is agent-agnostic: each agent has an **adapter** that knows where that agent stores transcripts and how to map them into one shared model. Everything else — search, CLI, server, web — operates on the normalized shape, so it works the same for every agent.

## The normalized model

A `Session` has metadata plus a list of `Event`s. The key event kinds are:

| kind | meaning |
| --- | --- |
| `text` | a user or assistant message |
| `thinking` | model reasoning |
| `tool_use` | a tool call (with its `tool`, `input`, and merged `result`) |
| `tool_result` | a standalone result (normally merged into its `tool_use`) |
| `hook` | a hook firing (its event, triggering tool, command, and any injected text) |
| `summary` / `system` | metadata-ish records |
| `unknown` | any record type the adapter doesn't specifically map — kept verbatim, never dropped |

Assistant turns may carry `usage` (and `model`) for [token / cost](./cost).

## Hooks & plugin attribution

Claude Code records hook firings in the transcript. agtail surfaces them as `hook` events: the **event** (PostToolUse, Stop, SessionStart, …), the **tool that triggered it** (resolved via the recorded `toolUseID`), the configured **command**, and — for `hook_additional_context` — the **text the hook injected**.

The transcript names the command but not the plugin. agtail resolves the owning **plugin** at display time by matching that command against your locally-installed plugin cache (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`). Because it's a local-install lookup, plugin chips only appear for plugins installed on this machine; imported sessions from elsewhere won't resolve.

## Programmatic & spawned sessions

A session records *how* it was launched — Claude's `entrypoint` (`cli`, `sdk-py`, `sdk-ts`, `claude-desktop`, …) or Codex's originator. agtail classifies SDK-driven launches as **programmatic** (filterable, and marked 🤖 in the UI).

A plugin can spawn a headless review via the Agent SDK, but the child session records no link back to the plugin. agtail infers it: the plugin builds the review prompt from a literal template in its own source, and the spawned session's prompt starts with that verbatim string, so the first line is matched against the SDK-calling plugins' sources. This is deliberately first-line-exact (an audit of real sessions showed looser matching misattributes plugins whose prompts share interior phrasing), and like hook attribution it only resolves locally-installed plugins.

## Claude Code

- **Location:** `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`
- The schema has many record types; agtail maps the core conversation precisely and surfaces the rest as `unknown`.
- Claude writes one API response across several lines (one per content block), each repeating the same `usage`. agtail counts usage **once per `message.id`** so tokens and cost aren't multiplied.
- **Subagents** live at `<parentId>/subagents/agent-<id>.jsonl` with a sibling `.meta.json` (`agentType`, `description`, the spawning `toolUseId`). agtail tags them as children of the parent session.

## Codex

- **Location:** `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`
- Recent Codex (v0.14x) indexes rollouts in a SQLite DB, but the files are glob-discoverable, so agtail reads them directly.
- Each line is `{ timestamp, type, payload }`. agtail's canonical timeline is the **`event_msg`** stream (clean user / assistant / reasoning / tool activity). The parallel `response_item` stream is the raw Responses-API mirror — it repeats messages and carries large system prompts — so it is intentionally not re-projected. Streaming `*_delta` events are skipped; any other subtype is surfaced as `unknown`.

## Empty sessions

Sessions with no actual conversation (e.g. a lone `bridge-session` metadata line) are excluded from listings — there is nothing to open.

## Transcript integrity

A single corrupt line never aborts a read — agtail parses around it. But it doesn't hide the loss either: for line-oriented (JSONL) transcripts it counts the unparseable lines it dropped, and flags the session **truncated** when the *last* line was the broken one (a strong "cut mid-write" signal — an interrupted or killed session). Both surface as a red ⚠ caveat in the session header (CLI and web), so an incomplete record can't be mistaken for a clean one. It's a forensic caveat, not a filter — clean reads carry no marker.

## Session ending & compaction

Two more execution-mechanics signals, each read from whatever the format actually records — never fabricated, so which ones appear differs by agent:

- **Ending** — flagged only when a session didn't end normally: *interrupted* (a turn started but never completed — Codex writes a `task_started` with no matching `task_complete`) or *limit* (the final turn hit the model's output-token cap — Claude's `stop_reason: max_tokens`). A normal ending carries no marker.
- **Compaction** — when an agent condenses its own context to stay within the window, agtail marks the boundary (Claude records it as `isCompactSummary`) and counts the boundaries on the session. Detail before a boundary is lost to everything after it, which often explains a later "it forgot X". Codex records no compaction marker, so its sessions never show one.

Both appear in the session header (CLI and web); compaction boundaries are also marked inline in the timeline where they occur.

Besides the native agent dirs, each adapter also reads agtail's own **import store** (`~/.local/share/agtail/imported/<collection>/<agent>/…`, honoring `XDG_DATA_HOME`), which mirrors the native layout. Sessions found there are tagged `imported` and carry their collection name, so synced-in history is searchable alongside local history but never masquerades as a session your agent could resume. See [Cross-machine sync](./sync).

## Adding an agent

New agents are added **in-tree** — the same way Claude Code and Codex ship. There is no runtime plugin loader to fork around: write an adapter, register it, done. (This mirrors how the comparable local viewers work; see [the positioning notes](./vs-otel).)

The steps:

1. Write an `Adapter` — either hand-written or via a helper (below).
2. Register it in `registerNodeAdapters` (`src/core/adapters/register-node.ts`):
   ```ts
   registerAdapters((overrides) => [
     claudeCodeAdapter(overrides["claude-code"]),
     codexAdapter(overrides["codex"]),
     myAgentAdapter(overrides["my-agent"]),   // ← added
   ]);
   ```
   The `Agent` id is an open string and validation is registry-driven, so nothing else needs to change — the id flows through CLI filters, facets and the web UI automatically. Reading `overrides["my-agent"]` is what lets `--dir my-agent=<path>` point the agent at a non-default session root.

An adapter emits the normalized `Session` / `Event` shapes and optionally implements `describeTool(tool, input)` to render its own tool calls as a one-line summary (return `undefined` to defer to the core summarizer, which the CLI **and** the web both use).

The built-ins hand-write the full `Adapter` interface (`roots()`, `findSessions()`, `readSession()`, `transferFiles()`) because their formats are idiosyncratic. For common on-disk shapes you don't have to — two internal helpers cover most agents.

### The easy path: `fileAdapter`

For the common shape — **one JSONL file per session under a directory** — `fileAdapter` (`src/core/adapters/file-adapter.ts`) writes the `Adapter` for you: it handles directory walking, the import-store scan, archived tagging, empty-stub skipping and export. You supply only `parse` (the raw-records → `Session` mapping):

```ts
import { fileAdapter } from "./file-adapter.js";

export const myAgentAdapter = (root?: string): Adapter =>
  fileAdapter({
    agent: "my-agent",
    root: root ?? "~/.my-agent/sessions",
    match: (name) => name.endsWith(".jsonl"),
    parse: (lines, ctx) => ({
      agent: "my-agent",
      id: ctx.id,          // filename fallback; return the real id here if it lives in the records
      path: ctx.path,
      mtime: ctx.mtime,
      title: "…", messages: lines.length,
      events: lines.map(toEvent),   // ← the only real work
    }),
  });
```

`fileAdapter` covers most on-disk layouts. Pick a **discovery unit** (`unit`) and exactly one **read mode**:

| your layout | `unit` | read mode | examples |
| --- | --- | --- | --- |
| one JSONL file per session | `"file"` (default) | `parse(lines, ctx)` | Codex, Gemini CLI |
| one whole-JSON file per session | `"file"` | `parseJson(data, ctx)` | Continue |
| one directory per session/task | `"dir"` | `read(path, ctx)` | Cline, Roo Code, OpenHands |
| anything else on a file/dir unit | either | `read(path, ctx)` | custom |

`match` selects which files (unit:"file", required) or filters subdirectory names (unit:"dir", optional). Other options: `base`, `archivedRoot` (a second root whose sessions are tagged `archived`), `transferMatch`, `importStore` (default true), `skipEmpty` (default true). A misconfigured call (no/2+ read modes, missing `match`) throws at registration.

`buildSession(ctx, events, extra)` (same module) derives the session's title, start/end times, models and message count from the events, so `parse` usually just maps records → events and hands them off.

The one shape `fileAdapter` does **not** model is *a single file holding many sessions* (e.g. Aider's `.aider.chat.history.md`) — that breaks unit == session; hand-write the `Adapter` interface directly. SQLite-backed agents use `sqliteAdapter` (below).

### SQLite-backed agents: `sqliteAdapter`

Some agents keep history in a single SQLite database with many sessions as rows (OpenCode, Goose, Cursor, …). Use `sqliteAdapter` (`src/core/adapters/sqlite-adapter.ts`) — it opens the DB read-only via Node's built-in `node:sqlite` (no dependency; loaded lazily), tolerates a missing file, and maps the synthetic session id ↔ path — you write only the two agent-specific queries:

```ts
import { sqliteAdapter } from "./sqlite-adapter.js";

export const myAgentAdapter = (root?: string): Adapter =>
  sqliteAdapter({
    agent: "my-agent",
    db: root ?? "~/.my-agent/history.db",
    listSessions: (db) => db.prepare("select id, title, cwd from sessions").all().map(rowToMeta),
    readSession: (db, id) => rowsToSession(db, id),   // query by id, build the Session
  });
```

Rows come back as plain objects with `unknown` fields — narrow them yourself. Note: `node:sqlite` is experimental (prints a one-time warning) and there is **no export** for DB-backed sessions (no per-session native file). Cursor in particular has a reverse-engineered, version-drifting schema and several overlapping stores — validate against the installed version.

### The import store

`fileAdapter` / `sqliteAdapter` already scan agtail's import store (synced-in histories). Hand-written `Adapter`s that want the same behaviour import `collectionDir`, `collectionOf`, `listCollections` from `src/core/imported.ts` — the Codex adapter is the reference example.

**Browser / playground note.** These adapters are **Node-only** (they use `node:fs` / `node:sqlite`), so they run in the CLI and the self-hosted `agtail serve`. The pure-web playground keeps `node:fs` out via dependency injection and ships a fixed in-memory adapter set. (Separately, "adapter" here is unrelated to Claude Code *marketplace* plugins, which agtail only reads for [hook/SDK attribution](#hooks-plugin-attribution).)
