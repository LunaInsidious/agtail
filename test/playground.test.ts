import { describe, expect, it } from "vitest";
import type { Filters } from "../src/web/lib/api.js";
import {
  apiExport,
  apiFacets,
  apiImport,
  apiSearch,
  apiSession,
  apiSessions,
  apiSources,
} from "../src/web/playground/backend.js";

// The playground's in-browser backend runs the real core engine over the bundled
// fictional sample (no server, no fs). These exercise it end to end in Node.
const filters = (over: Partial<Filters> = {}): Filters => ({
  q: "",
  agents: [],
  tools: [],
  models: [],
  cwds: [],
  since: "",
  until: "",
  kinds: [],
  mask: false,
  source: "",
  archived: "all",
  programmatic: "all",
  ...over,
});

describe("playground in-browser backend", () => {
  it("lists the sample sessions (incl. the nested subagent)", async () => {
    const sessions = await apiSessions({});
    expect(sessions.length).toBeGreaterThanOrEqual(6);
    expect(sessions.some((s) => s.title.includes("rate limiting"))).toBe(true);
    expect(sessions.some((s) => s.isSubagent)).toBe(true);
  });

  it("derives facets from the sample", async () => {
    const f = await apiFacets();
    expect(f.models).toContain("claude-opus-4-8");
    expect(f.tools).toContain("Bash");
    expect(f.cwds.some((c) => c.includes("northwind"))).toBe(true);
  });

  it("searches content across sessions", async () => {
    const hits = await apiSearch(filters({ q: "rate" }), 50);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("reads a session with real cost and plugin-attributed hooks", async () => {
    const list = await apiSessions({});
    const auth = list.find((s) => s.title.includes("Harden the auth"));
    expect(auth).toBeDefined();
    if (!auth) return;
    const sess = await apiSession(auth.agent, auth.id, false);
    expect(sess.usage?.costUsd).not.toBeNull();
    const hook = sess.events.find((e) => e.kind === "hook" && e.plugin);
    expect(hook?.plugin).toBe("security-guidance");
  });

  it("attributes the SDK-spawned review to its plugin", async () => {
    const list = await apiSessions({});
    const review = list.find((s) => s.programmatic && s.title.includes("Review this change"));
    expect(review?.spawnedBy).toBe("security-guidance");
  });

  it("round-trips export -> import into an in-memory collection", async () => {
    const text = await (await apiExport()).text();
    const res = await apiImport(text, { mode: "agtail", overwrite: false, collection: "team" });
    expect(res.written).toBeGreaterThan(0);
    const sources = await apiSources();
    expect(sources.some((s) => s.name === "team")).toBe(true);
    // Re-importing the same bundle into the same collection skips duplicates.
    const again = await apiImport(text, { mode: "agtail", overwrite: false, collection: "team" });
    expect(again.written).toBe(0);
    expect(again.skipped).toBeGreaterThan(0);
  });
});
