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

## The import store

Besides the native agent dirs, each adapter also reads agtail's own **import store** (`~/.local/share/agtail/imported/<collection>/<agent>/…`, honoring `XDG_DATA_HOME`), which mirrors the native layout. Sessions found there are tagged `imported` and carry their collection name, so synced-in history is searchable alongside local history but never masquerades as a session your agent could resume. See [Cross-machine sync](./sync).

## Adding an agent

Implement the `Adapter` interface (`roots()`, `findSessions()`, `readSession()`) so it emits the normalized `Session` / `Event` shapes, then register it. No other layer needs to change.
