import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { claudeCodeAdapter } from "../src/core/adapters/claude-code.js";
import { aggregateUsage } from "../src/core/cost.js";

const fixture = fileURLToPath(new URL("./fixtures/claude-session.jsonl", import.meta.url));
const hookFixture = fileURLToPath(new URL("./fixtures/claude-hook.jsonl", import.meta.url));

describe("claude-code adapter", () => {
  it("reads metadata and a clean title", async () => {
    const sess = await claudeCodeAdapter().readSession(fixture);
    expect(sess.cwd).toBe("/Users/testuser/proj");
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

  it("labels attachments by their subtype instead of a bare 'attachment'", async () => {
    const sess = await claudeCodeAdapter().readSession(fixture);
    expect(sess.events.some((e) => e.kind === "unknown" && e.text === "attachment · skill_listing")).toBe(true);
  });

  it("surfaces Stop-summary and per-event hook attachments as hook events", async () => {
    const sess = await claudeCodeAdapter().readSession(hookFixture);
    const hooks = sess.events.filter((e) => e.kind === "hook");
    const byType = new Map(hooks.map((h) => [h.hookEvent, h]));
    // Stop summary (hookInfos) + PostToolUse success + SessionStart error.
    expect(byType.get("Stop")?.text).toContain("security_reminder_hook.py");
    expect(byType.get("Stop")?.text).toContain("33ms");
    expect(byType.get("PostToolUse")?.text).toContain("PostToolUse:Write");
    const err = byType.get("SessionStart");
    expect(err?.text).toContain("✗");
    expect(err?.text).toContain("semgrep");
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
