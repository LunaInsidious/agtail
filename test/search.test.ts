import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { search } from "../src/core/search.js";

// Point both adapters at our fixtures dir so the cross-agent search runs over
// the synthetic Claude + Codex sessions together.
const fixturesDir = dirname(fileURLToPath(new URL("./fixtures/rollout-codex-test.jsonl", import.meta.url)));
const overrides = { "claude-code": fixturesDir, codex: fixturesDir } as const;

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
