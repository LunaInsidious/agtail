import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exportSessions, importSessions, type Bundle } from "../src/core/transfer.js";
import { matchingSessionRefs } from "../src/core/search.js";
import { collectionDir } from "../src/core/imported.js";
import { LOCAL_SOURCE, matchSource } from "../src/core/types.js";
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
    const bundle = await exportSessions({}, overrides);
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

describe("exportSessions selection", () => {
  it("bundles only the chosen sessions, not every transcript", async () => {
    // Sanity: an unfiltered claude export carries several fixtures.
    const all = await exportSessions({ agents: ["claude-code"] }, overrides);
    expect(all.files.length).toBeGreaterThan(1);

    const sessions = await claudeCodeAdapter(claudeRoot).findSessions();
    const one = sessions.find((m) => m.path.includes("claude-session.jsonl"));
    if (!one) throw new Error("fixture claude-session.jsonl missing");

    const picked = await exportSessions(
      { agents: ["claude-code"], selection: [{ agent: "claude-code", path: one.path }] },
      overrides,
    );
    expect(picked.files.length).toBe(1);
    expect(picked.files[0]?.rel).toBe("fixtures/claude-session.jsonl");
  });
});

describe("filtered export (matchingSessionRefs → exportSessions)", () => {
  it("bundles only the sessions matching a content filter", async () => {
    const full = await exportSessions({ agents: ["claude-code"] }, overrides);
    // "blogsync" appears only in the claude-session fixture.
    const refs = await matchingSessionRefs({ pattern: "blogsync", overrides });
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r) => r.path.includes("claude-session.jsonl"))).toBe(true);

    const bundle = await exportSessions({ selection: refs }, overrides);
    expect(bundle.files.length).toBeLessThan(full.files.length);
    expect(bundle.files.every((f) => f.rel.includes("claude-session"))).toBe(true);
  });
});

describe("importSessions --to agtail", () => {
  it("writes into a named collection that the adapter surfaces as imported", async () => {
    const bundle = await exportSessions({ agents: ["codex"] }, overrides);
    const res = await importSessions(bundle, { mode: "agtail", overwrite: false, collection: "alice" });
    expect(res.written).toBeGreaterThan(0);
    expect(res.skipped).toBe(0);

    // The default codex adapter now scans every collection under the store and
    // tags each session with the collection it came from.
    const scanned = await codexAdapter(codexRoot).findSessions();
    const active = scanned.find((m) => m.id === "active-0001" && m.imported);
    expect(active).toBeDefined();
    expect(active?.importedFrom).toBe("alice");
  });

  it("accepts a Japanese collection name and round-trips it", async () => {
    const bundle = await exportSessions({ agents: ["codex"] }, overrides);
    const res = await importSessions(bundle, { mode: "agtail", overwrite: false, collection: "田中のMac" });
    expect(res.written).toBeGreaterThan(0);

    expect(existsSync(collectionDir("田中のMac", "codex"))).toBe(true);
    const scanned = await codexAdapter(codexRoot).findSessions();
    const active = scanned.find((m) => m.id === "active-0001" && m.imported);
    expect(active?.importedFrom).toBe("田中のMac");
  });
});

describe("matchSource", () => {
  it("selects any / local-only / a specific collection", () => {
    const local = { imported: false };
    const alice = { imported: true, importedFrom: "alice" };
    // "" = any source
    expect(matchSource(local, "")).toBe(true);
    expect(matchSource(alice, "")).toBe(true);
    // LOCAL_SOURCE = this machine's own sessions only
    expect(matchSource(local, LOCAL_SOURCE)).toBe(true);
    expect(matchSource(alice, LOCAL_SOURCE)).toBe(false);
    // a named collection
    expect(matchSource(alice, "alice")).toBe(true);
    expect(matchSource(local, "alice")).toBe(false);
  });
});

describe("collection name guard", () => {
  it("rejects an unsafe collection name (no separators / ..)", async () => {
    const bundle: Bundle = {
      agtailExport: 1,
      created: new Date().toISOString(),
      files: [{ agent: "codex", rel: "x.jsonl", content: "y" }],
    };
    await expect(importSessions(bundle, { mode: "agtail", overwrite: false, collection: "../evil" })).rejects.toThrow(
      /invalid collection/,
    );
  });

  it("rejects a collection name longer than the cap", async () => {
    const bundle: Bundle = {
      agtailExport: 1,
      created: new Date().toISOString(),
      files: [{ agent: "codex", rel: "x.jsonl", content: "y" }],
    };
    await expect(
      importSessions(bundle, { mode: "agtail", overwrite: false, collection: "a".repeat(65) }),
    ).rejects.toThrow(/too long/);
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
    // The escaped path (one level above the collection base) must not exist.
    const escaped = join(collectionDir("imported", "codex"), "..", "escape.jsonl");
    expect(existsSync(escaped)).toBe(false);
  });
});

describe("importSessions skip vs overwrite", () => {
  it("skips an existing file unless overwrite is set", async () => {
    const store = collectionDir("imported", "codex");
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
