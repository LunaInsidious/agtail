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
    - theme: alt
      text: Try the playground
      link: https://lunainsidious.github.io/agtail/playground/

features:
  - title: Search-first
    details: grep is a first-class citizen. Cross-agent search built around compound filters — tool × model × cwd × time range × agent × origin. Timelines and stats are byproducts.
  - title: Agent-agnostic
    details: Claude Code and Codex are normalized into one schema and read through the same interface. One entry point, however many agents you add.
  - title: Read-only
    details: Never edits. It faithfully replays and extracts the fixed past. The original transcripts stay put; agtail owns the index and the search.
  - title: CLI and Web UI
    details: Query from the terminal with agtail grep / list / show / stats, or browse a search-first two-pane UI with agtail serve.
  - title: Tokens & cost
    details: Per-turn token counts and approximate cost. Prices are sourced from LiteLLM — a model it doesn't list shows "unknown" rather than a guess.
  - title: Hooks & plugin attribution
    details: Hook firings are first-class, searchable events — which event fired, which tool triggered it, the text it injected, and which installed plugin owns it.
  - title: Programmatic & subagent sessions
    details: SDK-spawned and subagent sessions are detected and nested under context. A spawned review is attributed back to the plugin that launched it.
  - title: Cross-machine sync
    details: Export sessions to a portable bundle and import them elsewhere into named collections, so one viewer can audit several machines or people side by side.
---
