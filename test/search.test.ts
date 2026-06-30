import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { search, searchSessionHits } from "../src/core/search.js";

// Point both adapters at our fixtures dir so the cross-agent search runs over
// the synthetic Claude + Codex sessions together.
const fixturesDir = dirname(fileURLToPath(new URL("./fixtures/rollout-codex-test.jsonl", import.meta.url)));
const overrides = { "claude-code": fixturesDir, codex: fixturesDir } as const;

// Isolate the import store: adapters also scan every imported collection under
// XDG_DATA_HOME, so without this the search runs over whatever real collections
// the developer's machine happens to hold and double-counts fixture sessions.
const env = { tmp: "", prev: process.env.XDG_DATA_HOME };
beforeEach(async () => {
  env.tmp = await mkdtemp(join(tmpdir(), "agtail-search-"));
  process.env.XDG_DATA_HOME = env.tmp;
});
afterEach(async () => {
  if (env.prev === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = env.prev;
  await rm(env.tmp, { recursive: true, force: true });
});

describe("search engine", () => {
  it("finds a term across both agents", async () => {
    const hits = await search({ pattern: "blogsync", overrides });
    const agents = new Set(hits.map((h) => h.agent));
    expect(agents.has("claude-code")).toBe(true);
    expect(agents.has("codex")).toBe(true);
  });

  it("filters by tool (exec only)", async () => {
    const hits = await search({ pattern: "", tools: ["exec"], overrides });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.kind === "tool_use" && h.tool === "exec")).toBe(true);
  });

  it("filters by agent", async () => {
    const hits = await search({ pattern: "build", agents: ["codex"], overrides });
    expect(hits.every((h) => h.agent === "codex")).toBe(true);
  });

  it("supports tool globs like mcp__*", async () => {
    const hits = await search({ pattern: "", tools: ["mcp__*"], overrides });
    expect(hits.every((h) => h.tool?.startsWith("mcp__"))).toBe(true);
  });
});

describe("session-level search", () => {
  it("returns one entry per matching session, with count + snippet", async () => {
    const hits = await searchSessionHits({ pattern: "blogsync", overrides });
    expect(hits.length).toBeGreaterThan(0);
    // No session appears twice.
    const keys = hits.map((h) => h.agent + ":" + h.sessionId);
    expect(new Set(keys).size).toBe(keys.length);
    // Each carries a positive match count and a representative snippet.
    expect(hits.every((h) => h.matchCount > 0 && h.snippet.length > 0)).toBe(true);
  });

  it("carries subagent linkage on hits so search results can nest", async () => {
    const subDir = fileURLToPath(new URL("./fixtures-sub", import.meta.url));
    const hits = await searchSessionHits({
      pattern: "repo",
      agents: ["claude-code"],
      overrides: { "claude-code": subDir },
    });
    const sub = hits.find((h) => h.isSubagent);
    expect(sub).toBeDefined();
    expect(sub?.parentId).toBe("parent-1");
    expect(sub?.agentName).toBe("Explore");
    // the matched parent is present too, so the UI nests the child under it
    expect(hits.some((h) => !h.isSubagent && h.sessionId === "parent-1")).toBe(true);
  });

  it("filters sessions by model membership (used the model in any turn)", async () => {
    const sonnet = await searchSessionHits({ pattern: "", models: ["claude-sonnet-4-6"], overrides });
    expect(sonnet.length).toBeGreaterThan(0);
    expect(sonnet.every((h) => h.models?.includes("claude-sonnet-4-6"))).toBe(true);
    // A model no session used yields nothing.
    const none = await searchSessionHits({ pattern: "", models: ["gpt-nonexistent"], overrides });
    expect(none.length).toBe(0);
  });

  it("filters by cwd, matching a session that contains ANY of the given substrings", async () => {
    const none = await searchSessionHits({ pattern: "", cwds: ["nope-not-a-path"], overrides });
    expect(none.length).toBe(0);
    // any-match: the bogus one is ignored as long as one substring matches.
    const some = await searchSessionHits({ pattern: "", cwds: ["nope-not-a-path", "proj"], overrides });
    expect(some.length).toBeGreaterThan(0);
    expect(some.every((h) => (h.cwd ?? "").includes("proj"))).toBe(true);
  });

  it("limit bounds the number of sessions returned", async () => {
    const all = await searchSessionHits({ pattern: "", overrides });
    expect(all.length).toBeGreaterThan(1);
    const capped = await searchSessionHits({ pattern: "", overrides, limit: 1 });
    expect(capped.length).toBe(1);
  });
});
