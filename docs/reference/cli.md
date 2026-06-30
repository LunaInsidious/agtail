# CLI reference

```
agtail [global options] <command> [command options]
```

## Global options

Put these before the command.

| Option | Description |
| --- | --- |
| `--mask` | Redact secrets in output (off by default) |
| `--archived <mode>` | Archived sessions: `all` (default) / `only` / `none` |
| `--programmatic <mode>` | Programmatic (SDK-driven) sessions: `all` (default) / `only` / `none` |
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
| `--source <name>` | Restrict to one imported collection (see `sources`) |
| `--regex` | Treat the pattern as a regular expression |
| `--case-sensitive` | Case-sensitive match (default is case-insensitive) |
| `--limit <n>` | Stop after n matches |
| `--json` | Emit NDJSON (one match per line) |

## `list`

| Option | Description |
| --- | --- |
| `--agent <agents>` | Limit to agents (comma-separated) |
| `--project <substr>` | Filter by cwd substring |
| `--source <name>` | Restrict to one imported collection |
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

## `export`

Bundle native (local) sessions into a portable JSON export. Filters select **which sessions** to bundle; each match exports its whole transcript. With no filters, every session is exported. See [Cross-machine sync](../guide/sync).

| Option | Description |
| --- | --- |
| `-o, --out <file>` | Write the bundle to a file (default: stdout) |
| `--agent <agents>` | Limit to agents (comma-separated) |
| `--query <text>` | Only sessions whose content matches this text |
| `--tool <glob>` | Only sessions using a tool; repeatable; globs allowed |
| `--model <name>` | Only sessions using a model; repeatable |
| `--cwd <substr>` | Only sessions whose cwd contains this |
| `--since <date>` / `--until <date>` | Only sessions with activity in the range |
| `--kind <kinds>` | Only sessions with these event kinds (comma-separated) |

## `import <file>`

Import a session bundle. Path-traversal entries and (without `--overwrite`) existing files are skipped, not written.

| Option | Description |
| --- | --- |
| `--to <dest>` | Destination: `agtail` (import store, default) / `native` (agent dirs) |
| `--name <collection>` | Collection to import into for `agtail` mode (default `imported`) |
| `--overwrite` | Overwrite files that already exist at the destination |

## `sources`

No options. Lists imported collections (one synced person/machine each) and their session counts.

## `serve`

| Option | Description |
| --- | --- |
| `--port <n>` | Port (default `8765`); always bound to `127.0.0.1` |

## Output

- `grep` default output is one line per hit: `agent:sessionId  timestamp  kind  tool  snippet`. With `--json`, each line is a JSON match object (NDJSON), suitable for pipes.
- `show` prints a timeline with per-turn token/cost badges.
- `stats` prints tool-usage counts and token/cost totals.
- `export` writes (or prints) the JSON bundle; `import` reports how many files were written vs. skipped.
