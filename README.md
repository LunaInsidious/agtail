# agtail

**ag**(ent) + **tail** — cross-agent forensic search for coding-agent histories.

Coding agents (Claude Code, Codex) run commands, edit files, and cause side
effects, but "what did it actually do back then?" is hard to reconstruct after
the fact. The transcripts hold enough information, but they're scattered,
unreadable raw JSONL, and impossible to grep across tools and projects. agtail
normalizes them into one searchable projection.

**Search is the point; viewing is secondary.** agtail is read-only — it never
edits transcripts; the originals stay where they are.

- **Agent-agnostic** — Claude Code (`~/.claude/projects`) and Codex
  (`~/.codex/sessions`) are normalized into one model and searched the same way.
- **CLI + Web UI** — grep from the terminal, or `serve` a local 2-pane viewer.
- It does **not** compete with the official apps on real-time viewing, rich
  rendering, or image previews — those are theirs.

## Install & build

```sh
pnpm install
pnpm build         # builds the web SPA (dist-web) + the CLI (dist)
```

Run the CLI with `node dist/cli/index.js <cmd>` (or `pnpm link --global` for `agtail`).

## CLI

```sh
# the primary command: search across every session, both agents
agtail grep blogsync

# filter by tool — only Bash runs, only Writes, only MCP side effects
agtail grep "" --tool Bash
agtail grep "" --tool Write --cwd myproject
agtail grep "" --tool 'mcp__*'

# compound filters: cwd × tool × period × agent, pipe-friendly NDJSON
agtail grep deploy --agent codex --since 2026-06-01 --until 2026-06-24 --json

agtail list                 # all sessions, newest first, source-tagged
agtail show <id>            # one session timeline   (--tools for tool calls only)
agtail stats <id>           # tool-usage counts + token/cost
agtail serve                # local web UI on http://127.0.0.1:8765
agtail --mask grep secret   # redact secrets in output
```

Common flags: `--mask`, `--claude-dir <path>`, `--codex-dir <path>`.

## Web UI

`agtail serve` opens a search-first 2-pane viewer: a global search box with
agent / tool / cwd / period filters, a cross-agent hit + session list with
source tags, and a timeline pane (Markdown text, collapse-by-default heavy
blocks, per-tool filtering, token/cost panel).

## Notes

- **Cost** is approximate and from a small user-maintained price table in
  `src/core/cost.ts`. Models not in the table show tokens but **no** cost — agtail
  never guesses a price.
- **Codex** stores rollout JSONL under `~/.codex/sessions/**/rollout-*.jsonl`
  (v0.14x indexes them in SQLite, but agtail reads the files directly). agtail's
  canonical Codex timeline is the `event_msg` stream for text plus the
  `response_item` stream for tool calls; unrecognized records are surfaced as
  `unknown`, never dropped.
