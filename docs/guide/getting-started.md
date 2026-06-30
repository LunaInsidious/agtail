# What is agtail

**ag**(ent) + **tail** — a forensic search tool for the histories of coding agents (Claude Code, Codex).

Agents are useful but opaque, and "what did that operation actually do?" is hard to reconstruct after the fact. The transcripts (`~/.claude/projects/**/*.jsonl` and friends) hold enough information, yet they have three limits: (1) raw JSONL isn't human-followable and can't be grepped across sessions, (2) it's tool-owned, volatile data — not an audit log, and (3) it's scattered per project, per session, per machine.

agtail fills those gaps. It normalizes the scattered transcripts into one searchable projection you can grep across tools and projects. **Search is the point; viewing is secondary.** See [Concepts](./concepts) for the full rationale.

![The agtail web UI: a unified, source-tagged session list on the left and a per-session timeline on the right.](/screenshots/overview.png)

::: tip
The screenshots throughout these docs use a small, fictional sample dataset (the "northwind" projects) — not anyone's real history. See `docs/screenshots/README.md` in the repo for how they're generated.
:::

::: tip Try it without installing
The [playground](https://lunainsidious.github.io/agtail/playground/) runs agtail entirely in your browser over that same fictional sample — search, the timeline, hooks, export/import, and a terminal view. Nothing is uploaded; imports stay in memory and reset on reload.
:::

## Requirements

- Node.js 20+
- pnpm
- The agent(s) whose history you want to read (Claude Code at `~/.claude/projects`, Codex at `~/.codex/sessions`)

## Install and build

```sh
pnpm install
pnpm build      # builds the web SPA (dist-web) and the CLI (dist)
```

Run the CLI with `node dist/cli/index.js <command>` (or `pnpm link --global` for `agtail`).

## First steps

```sh
# the primary command: search across every session
node dist/cli/index.js grep blogsync

# list sessions, newest first, source-tagged
node dist/cli/index.js list

# launch the web UI (127.0.0.1 only)
node dist/cli/index.js serve
# → http://127.0.0.1:8765
```

See [CLI](./cli) and [Web UI](./web-ui) for details.

## About these docs

The documentation site is managed independently from the app (it has its own `package.json` under `docs/`).

```sh
cd docs
pnpm install
pnpm dev        # local preview
pnpm build      # generate the static site (.vitepress/dist)
```
