import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exportSessions, importSessions, type Bundle } from "../src/core/transfer.js";
import { importStoreDir } from "../src/core/imported.js";
import { codexAdapter } from "../src/core/adapters/codex.js";
import { claudeCodeAdapter } from "../src/core/adapters/claude-code.js";

// The deterministic fixtures, with each agent pointed at a real root: claude at
// the flat fixtures dir, codex at the YYYY/MM/DD tree. RootOverrides override the
// ROOT; each adapter derives BASE = dirname(root).
const claudeRoot = fileURLToPath(new URL("./fixtures", import.meta.url));
const codexRoot = fileURLToPath(new URL("./fixtures/codex-home/sessions", import.meta.url));
const overrides = { "claude-code": claudeRoot, codex: codexRoot };

// Isolate the import store: point XDG_DATA_HOME at a fresh tmp dir per test so
// importStoreDir() (read lazily) lands under it and never touches the real store.
const env = { tmp: "", prev: process.env.XDG_DATA_HOME };
beforeEach(async () => {
  env.tmp = await mkdtemp(join(tmpdir(), "agtail-transfer-"));
  process.env.XDG_DATA_HOME = env.tmp;
});
afterEach(async () => {
  if (env.prev === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = env.prev;
  await rm(env.tmp, { recursive: true, force: true });
});

describe("exportSessions", () => {
  it("bundles native sessions for both agents with base-relative paths", async () => {
    const bundle = await exportSessions(undefined, overrides);
    expect(bundle.agtailExport).toBe(1);
    expect(typeof bundle.created).toBe("string");
    const agents = new Set(bundle.files.map((f) => f.agent));
    expect(agents.has("claude-code")).toBe(true);
    expect(agents.has("codex")).toBe(true);
    // rel is relative to BASE (dirname(root)), so a claude file keeps its leaf dir.
    const claude = bundle.files.find((f) => f.agent === "claude-code" && f.rel.includes("claude-session"));
    expect(claude?.rel).toBe("fixtures/claude-session.jsonl");
    expect(claude?.content).toContain("blogsync");
    // codex export pulls rollout-*.jsonl from the date tree.
    const codex = bundle.files.find((f) => f.agent === "codex");
    expect(codex?.rel).toMatch(/^sessions\//);
  });
});

describe("importSessions --to agtail", () => {
  it("writes files under the import store and re-scan surfaces them as imported", async () => {
    const bundle = await exportSessions(["codex"], overrides);
    const res = await importSessions(bundle, { mode: "agtail", overwrite: false });
    expect(res.written).toBeGreaterThan(0);
    expect(res.skipped).toBe(0);

    // The codex adapter scans importStoreDir("codex") and tags those imported.
    // Point the adapter's native root at the store so the scan walks it.
    const store = importStoreDir("codex");
    const scanned = await codexAdapter(join(store, "sessions")).findSessions();
    const active = scanned.find((m) => m.id === "active-0001");
    expect(active).toBeDefined();
    expect(active?.imported).toBe(true);
  });
});

describe("importSessions path-traversal guard", () => {
  it("rejects a rel that escapes the base (skipped, never written)", async () => {
    const bundle: Bundle = {
      agtailExport: 1,
      created: new Date().toISOString(),
      files: [{ agent: "codex", rel: "../escape.jsonl", content: "x" }],
    };
    const res = await importSessions(bundle, { mode: "agtail", overwrite: false });
    expect(res.written).toBe(0);
    expect(res.skipped).toBe(1);
    // The escaped path (one level above the store) must not exist.
    const escaped = join(importStoreDir("codex"), "..", "escape.jsonl");
    expect(existsSync(escaped)).toBe(false);
  });
});

describe("importSessions skip vs overwrite", () => {
  it("skips an existing file unless overwrite is set", async () => {
    const store = importStoreDir("codex");
    const rel = "sessions/2026/06/25/rollout-active.jsonl";
    const dest = join(store, rel);
    await mkdir(join(store, "sessions", "2026", "06", "25"), { recursive: true });
    await writeFile(dest, "ORIGINAL");

    const bundle: Bundle = {
      agtailExport: 1,
      created: new Date().toISOString(),
      files: [{ agent: "codex", rel, content: "NEW" }],
    };

    const skip = await importSessions(bundle, { mode: "agtail", overwrite: false });
    expect(skip.written).toBe(0);
    expect(skip.skipped).toBe(1);
    expect(await readFile(dest, "utf-8")).toBe("ORIGINAL");

    const over = await importSessions(bundle, { mode: "agtail", overwrite: true });
    expect(over.written).toBe(1);
    expect(over.skipped).toBe(0);
    expect(await readFile(dest, "utf-8")).toBe("NEW");
  });
});

describe("adapter base", () => {
  it("derives base as dirname(root)", () => {
    expect(claudeCodeAdapter(claudeRoot).base).toBe(dirname(claudeRoot));
    expect(codexAdapter(codexRoot).base).toBe(dirname(codexRoot));
  });
});
