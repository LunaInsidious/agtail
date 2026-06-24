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
| `summary` / `system` | metadata-ish records |
| `unknown` | any record type the adapter doesn't specifically map — kept verbatim, never dropped |

Assistant turns may carry `usage` (and `model`) for [token / cost](./cost).

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

## Adding an agent

Implement the `Adapter` interface (`roots()`, `findSessions()`, `readSession()`) so it emits the normalized `Session` / `Event` shapes, then register it. No other layer needs to change.
