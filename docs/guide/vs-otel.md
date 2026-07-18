# agtail vs OpenTelemetry

Modern coding agents increasingly emit OpenTelemetry — Claude Code, Codex, and
Gemini CLI all have built‑in support (metrics, traces, logs); others vary. So if the
telemetry already exists, why read local transcripts at all? Because OTel and agtail
answer **different questions**.

## Two different jobs

- **OpenTelemetry → Datadog / Grafana = observation.** Aggregate metrics and
  structured events across your whole fleet: cost, tokens, latency, error/tool‑failure
  rates, adoption, trends, alerts. Great for *"who is using AI, how much, at what cost
  and quality, trending which way."*
- **agtail = forensics.** The full content of an individual session — every message,
  the model's thinking, each tool call with its inputs / results / diffs, hooks, and
  subagents — searchable and reconstructable, read‑only, from the files already on disk.

## What OpenTelemetry does better

- Fleet dashboards, trends, and alerting.
- **Localizing:** drill from a cost or error spike down to the user / model / session,
  even the expensive turn (via `session.id` and per‑request cost events).

agtail is not a metrics tool — if that is your goal, use OTel.

## Where agtail is the right tool

Even for a drill‑down like *"which prompt blew up the cost,"* OTel gets you to the
session and turn — but to see **why** (the actual tool output, the giant file `Read`,
the loop, the accumulated context that ballooned tokens) you need the full transcript.
And in practice:

- **The content usually isn't in OTel.** Prompt/tool‑content logging is off by default
  (privacy, cost, egress), so the text often isn't shipped — or is truncated/sampled.
- **Retroactive.** agtail reads sessions that already ran, *including before any
  instrumentation was enabled*. OTel only has what it captured going forward.
- **No setup, and cross‑tool.** Most CLI agents now support OTel (Claude Code, Codex,
  Gemini CLI all do), but it has to be turned on ahead of time with a collector and a
  backend — which individuals rarely do. agtail reads any tool's local transcripts with
  zero configuration, including tools that emit no OTel (custom scripts, some IDE
  integrations) and, crucially, every session that ran before you set anything up.
- **Local & private.** Nothing leaves the machine — no backend, retention, or per‑GB
  cost. OTel ships content to a backend.
- **Faithful & complete.** agtail reads the raw files: full outputs, diffs, thinking,
  subagent threads — nothing truncated.
- **Zero setup.** No instrumentation, collector, or exporter to configure beforehand.

## Rule of thumb

- Want **metrics, dashboards, and alerts across a team** → OpenTelemetry + Datadog /
  Grafana.
- Want to **read, search, and reconstruct what an individual session actually did** —
  completely, retroactively, across tools, and locally → **agtail**.

They compose well: **OTel spots the anomaly or trend; agtail opens the offending
session and shows you what actually happened.**
