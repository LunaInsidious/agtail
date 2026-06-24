import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { claudeCodeAdapter } from "../src/core/adapters/claude-code.js";
import { aggregateUsage } from "../src/core/cost.js";

const fixture = fileURLToPath(new URL("./fixtures/claude-session.jsonl", import.meta.url));

describe("claude-code adapter", () => {
  it("reads metadata and a clean title", async () => {
    const sess = await claudeCodeAdapter().readSession(fixture);
    expect(sess.cwd).toBe("/Users/itsuki_t/proj");
    expect(sess.gitBranch).toBe("main");
    expect(sess.model).toBe("claude-opus-4-8");
    expect(sess.title).toBe("please grep for blogsync");
  });

  it("merges tool_result into its tool_use", async () => {
    const sess = await claudeCodeAdapter().readSession(fixture);
    const tu = sess.events.find((e) => e.kind === "tool_use");
    expect(tu?.tool).toBe("Bash");
    expect(tu?.result?.text).toContain("blogsync entry");
    // the standalone tool_result line should not remain
    expect(sess.events.some((e) => e.kind === "tool_result")).toBe(false);
  });

  it("surfaces non-core records as unknown", async () => {
    const sess = await claudeCodeAdapter().readSession(fixture);
    expect(sess.events.some((e) => e.kind === "unknown" && e.text === "attachment")).toBe(true);
  });

  it("excludes empty stub sessions (e.g. a lone bridge-session line)", async () => {
    const dir = fileURLToPath(new URL("./fixtures", import.meta.url));
    const metas = await claudeCodeAdapter(dir).findSessions();
    expect(metas.some((m) => m.id === "empty-stub")).toBe(false);
    expect(metas.some((m) => m.id === "claude-session")).toBe(true);
  });

  it("counts usage once per message id (Claude splits one response across lines)", async () => {
    const p = fileURLToPath(new URL("./fixtures-usage/split.jsonl", import.meta.url));
    const sess = await claudeCodeAdapter().readSession(p);
    const withUsage = sess.events.filter((e) => e.usage);
    expect(withUsage.length).toBe(1); // not 3, despite 3 lines repeating the usage
    const u = aggregateUsage(sess.events, () => null);
    expect(u.inputTokens).toBe(100); // not 300
    expect(u.outputTokens).toBe(10); // not 30
    expect(u.cacheReadTokens).toBe(50); // not 150
  });

  it("aggregates usage and prices a model the resolver knows", async () => {
    const sess = await claudeCodeAdapter().readSession(fixture);
    const resolve = (m?: string) => (m && m.includes("opus") ? { input: 15, output: 75 } : null);
    const u = aggregateUsage(sess.events, resolve);
    expect(u.inputTokens).toBe(2000);
    expect(u.outputTokens).toBe(300);
    expect(u.costUsd).toBeGreaterThan(0);
  });
});
