# CLI

Run every command with `node dist/cli/index.js <command>` (or `agtail <command>`). For the exhaustive list of flags, see the [CLI reference](../reference/cli).

## grep — the primary command

Search across every session.

```sh
# find a term across all agents
agtail grep blogsync

# filter by tool kind: only Bash runs / only specific Writes / only MCP side effects
agtail grep "" --tool Bash
agtail grep "" --tool Write --cwd myproject
agtail grep "" --tool 'mcp__*'

# compound: cwd × tool × time range × agent, NDJSON for pipes
agtail grep deploy --agent codex --since 2026-06-01 --until 2026-06-24 --json
```

It searches message text, tool input (command, file_path, url, query, …), tool results, and thinking. `--tool` accepts globs (e.g. `mcp__*`) and can be repeated.

## list

List sessions, newest first. Source-tagged (claude / codex), with subagents nested under their parent.

```sh
agtail list
agtail list --agent codex
agtail list --project myproject
```

## show

Print one session's timeline.

```sh
agtail show <id>            # id can be a prefix
agtail show <id> --tools    # tool calls only
```

Each assistant turn is annotated with token / cost, like `[42,548 tok ≈$0.5851]` (see [Tokens & cost](./cost)). A subagent session shows a `↳ subagent (Explore) of <parentId>` header.

## stats

Tool-usage counts plus token / cost totals.

```sh
agtail stats <id>           # one session
agtail stats                # all sessions
agtail stats --project foo
```

## serve

Launch the local web UI (127.0.0.1 only — no external traffic).

```sh
agtail serve                # http://127.0.0.1:8765
agtail serve --port 9000
```

See [Web UI](./web-ui) for details.

## Common options

| Option | Description |
| --- | --- |
| `--mask` | Redact secrets in output (off by default — original text is shown) |
| `--claude-dir <path>` | Override the Claude Code root (default `~/.claude/projects`) |
| `--codex-dir <path>` | Override the Codex root (default `~/.codex/sessions`) |
