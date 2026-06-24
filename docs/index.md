---
layout: home

hero:
  name: agtail
  text: Cross-agent search for coding-agent histories
  tagline: Forensic, after-the-fact search across Claude Code and Codex — "where did that operation happen, and what did it do?" Search first; viewing is secondary.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Concepts
      link: /guide/concepts

features:
  - title: Search-first
    details: grep is a first-class citizen. Cross-agent search built around compound filters — tool × cwd × time range × agent. Timelines and stats are byproducts.
  - title: Agent-agnostic
    details: Claude Code and Codex are normalized into one schema and read through the same interface. One entry point, however many agents you add.
  - title: Read-only
    details: Never edits. It faithfully replays and extracts the fixed past. The original transcripts stay put; agtail owns the index and the search.
  - title: CLI and Web UI
    details: Query from the terminal with agtail grep / list / show / stats, or dig through a two-pane browser UI with agtail serve.
  - title: Tokens & cost
    details: Per-turn token counts and approximate cost. Prices are sourced from LiteLLM — a model it doesn't list shows "unknown" rather than a guess.
  - title: Subagents
    details: Sessions spawned via Task are shown as children of their parent. A sidechain "user" message is correctly labeled as the parent agent.
---
