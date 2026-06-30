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
- **Hooks & plugins** — hook firings are first-class, searchable events,
  attributed to the installed plugin that owns them.
- **Cross-machine sync** — `export`/`import` sessions into named collections to
  audit several machines or people in one viewer.
- **Try it in the browser** — a server-less [playground](#playground) runs the
  whole thing over fictional sample data (no install, nothing uploaded).
- It does **not** compete with the official apps on real-time viewing, rich
  rendering, or image previews — those are theirs.

📖 Docs: <https://lunainsidious.github.io/agtail/> · 🛝 Playground: <https://lunainsidious.github.io/agtail/playground/>

## Requirements

- Node.js 22+
- pnpm
- The agent(s) whose history you want to read (Claude Code at `~/.claude/projects`, Codex at `~/.codex/sessions`)

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

# cross-machine sync
agtail export -o my.json            # bundle local sessions (filterable like grep)
agtail import alice.json --name alice   # into a named collection
agtail sources                      # list imported collections
```

Common flags: `--mask`, `--archived <mode>`, `--programmatic <mode>`,
`--claude-dir <path>`, `--codex-dir <path>`. Full reference in `docs/`.

## Web UI

`agtail serve` opens a search-first 2-pane viewer:

- a global **search box** with recent-search history and named **saved searches**;
- a **Filters** popover (tool / model / cwd / date / agent / status / origin / mask);
- a cross-agent **session + hit list** with source tags, subagent nesting, and marks
  for archived / imported / 🤖 programmatic (SDK-spawned) sessions;
- a **timeline** — Markdown text, collapse-by-default heavy blocks, per-turn
  token/cost badges, **hook events** (labeled by event, triggering tool, and owning
  plugin), and an **in-session search**;
- a **light/dark theme** toggle, plus a **source switcher** (once you have imports)
  to scope the view to one collection.

For cross-machine sync there's also **Import**/**Export** in the UI (the filtered
export re-runs your current filter server-side).

## Playground

A static, server-less build runs agtail **entirely in the browser** over a
fictional sample dataset — so you can try search, the timeline, hooks,
export/import, and a terminal view (`list` / `grep` / `show` / `stats`) without
installing anything or exposing real history. Imports stay in memory and reset on
reload. Hosted at the link above; build/run it yourself with:

```sh
pnpm build:playground   # → dist-playground/ (base /agtail/playground/)
pnpm dev:playground     # local dev server
```

The same app code runs the real core engine in the browser (the `/api` layer is
swapped for an in-browser backend; `node:*` is aliased to browser shims at build).

It's intentionally **self-contained and offline** — it never calls LiteLLM or any
backend. You can import your own exported bundle (it's fully searchable and stays
in your browser), but two things are limited vs. the installed tool: **cost** is
priced only for the sample's models, and **plugin attribution** only resolves the
sample's plugins. For full LiteLLM pricing and your own plugins, run agtail locally.

## Development

One TypeScript codebase in layers: `src/core` (adapters + the normalized model,
search, cost, masking), `src/cli`, `src/server`, and `src/web` (the React SPA).
The documentation site under `docs/` is an independent pnpm project.

```sh
pnpm check          # typecheck + lint + depcruise + knip + format + unit tests
pnpm test           # unit tests (vitest)
pnpm test:e2e       # Playwright end-to-end (system Chrome)
pnpm dev:web        # web UI with hot reload (self-contained — /api is built in)
pnpm dev:cli <cmd>  # run the CLI from source

cd docs && pnpm install && pnpm dev   # docs site (English + 日本語)
```

Quality gates are enforced: `oxlint`/`biome` (incl. a no-`let`, assertion-free
style), `dependency-cruiser` for layer boundaries, and `knip` for dead code.

## Notes

- **Cost** is approximate and sourced from LiteLLM's community price sheet
  (cached on disk, refetched weekly). Models LiteLLM doesn't list show tokens but
  **no** cost — agtail never guesses a price.
- **Codex** stores rollout JSONL under `~/.codex/sessions/**/rollout-*.jsonl`
  (v0.14x indexes them in SQLite, but agtail reads the files directly). agtail's
  canonical Codex timeline is the `event_msg` stream for text plus the
  `response_item` stream for tool calls; unrecognized records are surfaced as
  `unknown`, never dropped.
