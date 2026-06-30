# Cross-machine sync

Transcripts live per-machine. agtail can **export** a set of sessions into one portable JSON bundle and **import** it on another machine, so a single viewer can search across several machines — or one auditor can review several people's histories side by side.

## Export

Export bundles your **native** (local, non-imported) sessions into a single JSON file.

```sh
# everything, to a file
agtail export -o my-sessions.json

# a filtered subset (same filters as grep): only these become a bundle
agtail export --query deploy --tool Bash --since 2026-06-01 -o deploy-audit.json
agtail export --agent codex --cwd northwind-web -o web.json
```

In the web UI, the list header's **Export** action does the same: *Export all*, or *Export results* when a search/filter is active (the filter is re-run server-side, unbounded, so the bundle matches exactly what you filtered).

The bundle is a plain JSON document (`{ agtailExport: 1, created, files: [...] }`) carrying each transcript's relative path and contents — diffable and safe to inspect before sharing.

## Import

Import writes a bundle's sessions to one of two destinations:

| Destination | Where it lands | Use it for |
| --- | --- | --- |
| **agtail** (default) | agtail's own import store, grouped into a named **collection** | viewing/auditing other machines without touching your agents |
| **native** | the real agent dirs (`~/.claude/projects`, …) | restoring your own sessions onto a new machine |

```sh
# default: into the agtail store, collection "imported"
agtail import my-sessions.json

# into a named collection (one per person/machine you audit)
agtail import alice.json --name alice

# restore into the real agent dirs (your own sessions, new laptop)
agtail import my-sessions.json --to native

# allow overwriting files that already exist at the destination
agtail import my-sessions.json --overwrite
```

Without `--overwrite`, files that already exist are **skipped**, and the command reports how many were written vs. skipped. Bundle paths that would escape the destination (via `..`) are rejected, never written.

::: warning native + overwrite
`--to native --overwrite` writes into your live agent directories *and* replaces existing files — the one combination that can clobber real history. The web UI gates it behind an explicit acknowledgement for this reason.
:::

## Collections and the source switcher

Imports into the agtail store are grouped into **collections** — `imported/<collection>/<agent>/…` — so several sources stay distinct. Each collection is a single person or machine.

- `agtail sources` lists your collections and their session counts.
- In the web UI, the **source switcher** (which appears once you have at least one import) scopes the whole view to *All sources*, *Local* (this machine's own sessions), or one collection.

Imported sessions are tagged so they never masquerade as local history your agent might resume — they live outside the native dirs and are visibly marked in the list.
