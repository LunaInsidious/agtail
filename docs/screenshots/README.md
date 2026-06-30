# Documentation screenshots

The screenshots in the docs are generated from a **fictional** sample dataset
(`sample/`, the "northwind" projects) — never anyone's real history — so they're
safe to publish and reproducible.

## Regenerate

From the repo root:

```sh
# 1. build the web SPA (serve ships dist-web)
npx vite build

# 2. serve the sample data in an isolated store, with the fixture plugins so
#    plugin chips resolve (XDG_DATA_HOME → empty dir = no real imports leak in)
mkdir -p /tmp/agtail-shot-store
XDG_DATA_HOME=/tmp/agtail-shot-store \
AGTAIL_PLUGINS_DIR="$(pwd)/test/fixtures/plugins" \
  npx tsx src/cli/index.ts \
    --claude-dir docs/screenshots/sample \
    --codex-dir docs/screenshots/sample \
    serve --port 4787 &

# 3. capture (system Chrome; writes PNGs into docs/public/screenshots/)
node docs/screenshots/capture.mjs
```

## What's where

- `sample/` — the fictional transcripts (Claude Code + Codex), including a
  subagent, a hooks session, and an SDK-spawned review. Edit these to change
  what the screenshots show.
- `capture.mjs` — drives a headless browser to produce
  `overview / filters / timeline / hooks / search` PNGs.
- `../public/screenshots/` — the committed output, referenced from the docs as
  `/screenshots/<name>.png`.

The two env vars matter: `XDG_DATA_HOME` points the import store at a throwaway
dir so your real imported collections don't appear, and `AGTAIL_PLUGINS_DIR`
points at the test fixture plugins so the 🧩 plugin chips resolve against the
sample's `security-guidance` hooks/prompts.
