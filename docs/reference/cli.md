# CLI reference

```
agtail [global options] <command> [command options]
```

## Global options

| Option | Description |
| --- | --- |
| `--mask` | Redact secrets in output (off by default) |
| `--claude-dir <path>` | Override the Claude Code root (default `~/.claude/projects`) |
| `--codex-dir <path>` | Override the Codex root (default `~/.codex/sessions`) |

## `grep <pattern>`

Search across all sessions. An empty pattern (`""`) means filter-only.

| Option | Description |
| --- | --- |
| `--agent <agents>` | Limit to agents, comma-separated: `claude-code,codex` |
| `--tool <glob>` | Restrict to a tool; repeatable; globs allowed (`Bash`, `Write`, `mcp__*`) |
| `--cwd <substr>` | Restrict to sessions whose cwd contains this |
| `--since <date>` | Only events at/after this ISO date |
| `--until <date>` | Only events at/before this ISO date (date-only includes the whole day) |
| `--kind <kinds>` | Restrict to event kinds, comma-separated |
| `--regex` | Treat the pattern as a regular expression |
| `--case-sensitive` | Case-sensitive match (default is case-insensitive) |
| `--limit <n>` | Stop after n matches |
| `--json` | Emit NDJSON (one match per line) |

## `list`

| Option | Description |
| --- | --- |
| `--agent <agents>` | Limit to agents (comma-separated) |
| `--project <substr>` | Filter by cwd substring |
| `--since <date>` / `--until <date>` | Time-range filter |

## `show <id>`

`id` may be a prefix.

| Option | Description |
| --- | --- |
| `--agent <agents>` | Limit to agents (comma-separated) |
| `--tools` | Show tool calls only |

## `stats [id]`

| Option | Description |
| --- | --- |
| `--agent <agents>` | Limit to agents (comma-separated) |
| `--project <substr>` | Filter by cwd substring |

## `serve`

| Option | Description |
| --- | --- |
| `--port <n>` | Port (default `8765`); always bound to `127.0.0.1` |

## Output

- `grep` default output is one line per hit: `agent:sessionId  timestamp  kind  tool  snippet`. With `--json`, each line is a JSON match object (NDJSON), suitable for pipes.
- `show` prints a timeline with per-turn token/cost badges.
- `stats` prints tool-usage counts and token/cost totals.
