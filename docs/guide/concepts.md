# Concepts

## Why it exists

Coding agents quietly run sequences of commands, rewrite files, and cause external side effects. Reconstructing "what did that do?" afterward is hard, and the cost is real — an agent overwrites data in one step, and only when you try to investigate later do you realize the record wasn't there.

In STRIDE terms this is a **Repudiation** problem, and on a personal CLI machine it's the first gap worth closing. The goal was never a pretty viewer; it was being able to narrow down, after the fact, "that operation — which command was it, and what did it actually do?"

## Core principles

### Search-first
`grep` is a first-class citizen. The tool is built around compound filtering — by tool kind, cwd, time range, and agent. Timelines and aggregation are byproducts.

### Read-only
It never edits. It faithfully replays and extracts the fixed past. The original transcripts stay where they are; agtail owns the index and the search — a clean division of labor.

### Agent-agnostic
Claude and Codex transcripts are normalized into one schema and read through one interface. Adding an agent doesn't change the entry point. See [Adapters & the normalized model](./adapters).

### Never silently dropped
Unknown record types are not discarded — they're surfaced as `unknown` events. Nothing disappears from a transcript.

### No fallbacks
When a precondition is missing, agtail fails loudly or reports "unknown" rather than fudging a plausible value. For example, cost is not estimated for a model whose price is unknown — it shows "unknown" (see [Tokens & cost](./cost)).

## How it differs from the official apps

Claude Desktop and the Codex app can both browse your local sessions. agtail still exists because its scope is different.

**What agtail takes on:**

- **Cross-agent search** — grep every session across tools and projects at once
- **CLI / automation** — pipe `agtail grep ... | ...`, run it from CI
- **Tool-axis analysis** — "how many Bash runs this week, which files saw the most Writes"
- **Freedom to transform / export** — masking, JSONL projection

**What it leaves to the official apps (and won't compete on):**

- Real-time conversation replay, rich rendering, attached-image previews

agtail commits fully to after-the-fact search and analysis, and doesn't compete on live viewing.
