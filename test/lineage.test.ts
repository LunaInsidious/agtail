import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { findAllSessions, listLinkedSessions, resolveSession } from "../src/core/adapters/index.js";
import { hookWindows, linkHookSpawns as link, withHookSpawnLinks, type ScannedMeta } from "../src/core/lineage.js";
import { claudeCodeAdapter } from "../src/core/adapters/claude-code.js";
import { codexAdapter } from "../src/core/adapters/codex.js";
import type { Agent, Event, Session, SessionMeta } from "../src/core/types.js";

const CWD = "/work/proj";

// A hook firing that ran for `ms` and ended at `end` (its recorded timestamp).
const hook = (end: string, ms: number, cwd = CWD): Event => ({
  kind: "hook",
  ts: end,
  hookEvent: "PostToolUse",
  hookRun: { start: new Date(Date.parse(end) - ms).toISOString(), end, cwd },
  raw: {},
});

const meta = (id: string, extra: Partial<SessionMeta> = {}): SessionMeta => ({
  agent: "claude-code",
  id,
  path: `/p/${id}.jsonl`,
  cwd: CWD,
  title: id,
  messages: 1,
  mtime: 0,
  ...extra,
});

// An SDK session (the kind a Claude hook launches) starting at `started`.
const sdk = (id: string, started: string, extra: Partial<SessionMeta> = {}) =>
  meta(id, { programmatic: true, origin: "sdk-py", started, ...extra });

// A headless `codex exec` session starting at `started`.
const codexExec = (id: string, started: string, extra: Partial<SessionMeta> = {}) =>
  meta(id, { agent: "codex", programmatic: true, origin: "codex_exec", started, ...extra });

const entry = (m: SessionMeta, events: Event[] = []): ScannedMeta => ({ ...m, hookWindows: hookWindows(events) });

// The real adapters' rules, so the tests pin the shipped candidate predicates
// and startup slacks.
const rules = new Map<Agent, ReturnType<typeof claudeCodeAdapter>["spawnRule"]>([
  ["claude-code", claudeCodeAdapter().spawnRule],
  ["codex", codexAdapter().spawnRule],
]);
const ruleOf = (agent: Agent) => rules.get(agent);
const linkHookSpawns = (scanned: ScannedMeta[]) => link(scanned, ruleOf);

describe("hook-spawn lineage", () => {
  const parentHooks = [hook("2026-09-28T15:52:20.300Z", 1300)]; // ran 15:52:19.000 – 20.300

  it("links an SDK session that started while a hook ran, marked as inferred", () => {
    const [, child] = linkHookSpawns([
      entry(meta("parent"), parentHooks),
      entry(sdk("child", "2026-09-28T15:52:19.556Z")),
    ]);
    expect(child?.parentId).toBe("parent");
    expect(child?.parentAgent).toBe("claude-code");
    expect(child?.parentInferred).toBe(true);
  });

  it("drops the hook windows from the listing it returns", () => {
    const out = linkHookSpawns([entry(meta("parent"), parentHooks)]);
    expect(out[0]).not.toHaveProperty("hookWindows");
  });

  it("allows a short slack after the hook ends (a detached child starts after it exits)", () => {
    const [, child] = linkHookSpawns([
      entry(meta("parent"), parentHooks),
      entry(sdk("child", "2026-09-28T15:52:21.250Z")),
    ]);
    expect(child?.parentId).toBe("parent");
  });

  it("does not link outside the window, or in a different cwd", () => {
    const [, late, elsewhere] = linkHookSpawns([
      entry(meta("parent"), parentHooks),
      entry(sdk("late", "2026-09-28T15:52:25.000Z")),
      entry(sdk("elsewhere", "2026-09-28T15:52:19.556Z", { cwd: "/other" })),
    ]);
    expect(late?.parentId).toBeUndefined();
    expect(elsewhere?.parentId).toBeUndefined();
  });

  it("matches the hook record's own cwd, not the session's first cwd (a cd into a worktree)", () => {
    const [, child] = linkHookSpawns([
      entry(meta("parent", { cwd: "/work/main" }), [hook("2026-09-28T15:52:20.300Z", 1300, "/work/wt")]),
      entry(sdk("child", "2026-09-28T15:52:19.556Z", { cwd: "/work/wt" })),
    ]);
    expect(child?.parentId).toBe("parent");
  });

  it("leaves the child unlinked when two sessions' hooks both contain its start", () => {
    const [, , child] = linkHookSpawns([
      entry(meta("a"), parentHooks),
      entry(meta("b"), parentHooks),
      entry(sdk("child", "2026-09-28T15:52:19.556Z")),
    ]);
    expect(child?.parentId).toBeUndefined();
  });

  it("only considers SDK sessions, and never relinks a recorded parent", () => {
    const [, interactive, subagent] = linkHookSpawns([
      entry(meta("parent"), parentHooks),
      entry(meta("interactive", { started: "2026-09-28T15:52:19.556Z" })),
      entry(sdk("sub", "2026-09-28T15:52:19.556Z", { isSubagent: true, parentId: "real" })),
    ]);
    expect(interactive?.parentId).toBeUndefined();
    expect(subagent?.parentId).toBe("real");
    expect(subagent?.parentInferred).toBeUndefined();
  });

  it("does not link across import collections", () => {
    const [, child] = linkHookSpawns([
      entry(meta("parent"), parentHooks),
      entry(sdk("child", "2026-09-28T15:52:19.556Z", { imported: true, importedFrom: "laptop" })),
    ]);
    expect(child?.parentId).toBeUndefined();
  });

  it("marks the launching hook row in the parent, and carries the link onto the child's read", () => {
    const listed = linkHookSpawns([
      entry(meta("parent"), parentHooks),
      entry(sdk("child", "2026-09-28T15:52:19.556Z")),
    ]);
    const [parentMeta, childMeta] = listed;
    if (!parentMeta || !childMeta) throw new Error("expected two metas");
    const otherHook = hook("2026-09-28T15:50:00.000Z", 500);
    const parent: Session = { ...parentMeta, events: [otherHook, ...parentHooks] };
    const read = withHookSpawnLinks(parent, parentMeta, listed, ruleOf);
    expect(read.events[0]?.spawnedSessions).toBeUndefined();
    expect(read.events[1]?.spawnedSessions).toEqual([{ id: "child", agent: "claude-code", inferred: true }]);

    const child: Session = { ...childMeta, parentId: undefined, parentInferred: undefined, events: [] };
    const childRead = withHookSpawnLinks(child, childMeta, listed, ruleOf);
    expect(childRead.parentId).toBe("parent");
    expect(childRead.parentAgent).toBe("claude-code");
    expect(childRead.parentInferred).toBe(true);
  });
});

describe("cross-agent hook-spawn lineage (a Claude Code hook running codex exec)", () => {
  // Timings from a live run: hook ran 06:21:18.602 – 22.853; codex started 20.759.
  const claudeHooks = [hook("2026-10-21T06:21:22.853Z", 4251)];

  it("links a codex exec session to the Claude session whose hook was running", () => {
    const [, child] = linkHookSpawns([
      entry(meta("claude-parent"), claudeHooks),
      entry(codexExec("codex-child", "2026-10-21T06:21:20.759Z")),
    ]);
    expect(child?.parentId).toBe("claude-parent");
    expect(child?.parentAgent).toBe("claude-code");
    expect(child?.parentInferred).toBe(true);
  });

  it("gives Codex its own, longer startup slack (a detached codex starts ~2s after its hook exits)", () => {
    // Live runs: detached codex first record 1.6–2.2s after the hook's end.
    const shortHook = [hook("2026-10-21T06:30:32.850Z", 4)];
    const [, codexChild, claudeChild] = linkHookSpawns([
      entry(meta("parent"), shortHook),
      entry(codexExec("codex-child", "2026-10-21T06:30:35.090Z")),
      entry(sdk("claude-child", "2026-10-21T06:30:35.090Z")),
    ]);
    expect(codexChild?.parentId).toBe("parent");
    expect(claudeChild?.parentId).toBeUndefined(); // 2.24s is past Claude's 1s slack
  });

  it("never treats an interactive or IDE Codex session as a hook's child", () => {
    const [, tui, ide] = linkHookSpawns([
      entry(meta("parent"), claudeHooks),
      entry(meta("tui", { agent: "codex", started: "2026-10-21T06:21:20.759Z" })),
      entry(
        meta("ide", {
          agent: "codex",
          programmatic: true,
          origin: "codex_vscode",
          started: "2026-10-21T06:21:20.759Z",
        }),
      ),
    ]);
    expect(tui?.parentId).toBeUndefined();
    expect(ide?.parentId).toBeUndefined();
  });

  it("accepts the Codex SDK originators as hook-launchable", () => {
    const [, child] = linkHookSpawns([
      entry(meta("parent"), claudeHooks),
      entry(
        meta("sdk", {
          agent: "codex",
          programmatic: true,
          origin: "codex_sdk_ts",
          started: "2026-10-21T06:21:20.759Z",
        }),
      ),
    ]);
    expect(child?.parentId).toBe("parent");
  });

  it("counts candidate parents across agents for the ambiguity rule", () => {
    // A same-id session in another agent is a different session, so two
    // windows (one per agent) still mean ambiguity.
    const [, , child] = linkHookSpawns([
      entry(meta("p1"), claudeHooks),
      entry(meta("p2", { agent: "other" }), claudeHooks),
      entry(codexExec("codex-child", "2026-10-21T06:21:20.759Z")),
    ]);
    expect(child?.parentId).toBeUndefined();
  });

  it("never links sessions of an agent that declares no spawn rule", () => {
    const [, child] = linkHookSpawns([
      entry(meta("parent"), claudeHooks),
      entry(meta("x", { agent: "norule", programmatic: true, origin: "sdk-py", started: "2026-10-21T06:21:20.759Z" })),
    ]);
    expect(child?.parentId).toBeUndefined();
  });

  it("links the Claude hook row to the Codex child, tagged with the child's agent", () => {
    const listed = linkHookSpawns([
      entry(meta("claude-parent"), claudeHooks),
      entry(codexExec("codex-child", "2026-10-21T06:21:20.759Z")),
    ]);
    const [parentMeta, childMeta] = listed;
    if (!parentMeta || !childMeta) throw new Error("expected two metas");
    const read = withHookSpawnLinks({ ...parentMeta, events: claudeHooks }, parentMeta, listed, ruleOf);
    expect(read.events[0]?.spawnedSessions).toEqual([{ id: "codex-child", agent: "codex", inferred: true }]);
  });

  it("marks only the ONE most likely launching hook row, not every window in the slack", () => {
    // Live run 4a62e50b: SessionStart + a plugin's UserPromptSubmit both ended
    // within Codex's slack before the child started; the real hook was running.
    const sessionStart = hook("2026-10-21T06:21:18.572Z", 1831);
    const pluginPrompt = hook("2026-10-21T06:21:18.615Z", 14);
    const events = [sessionStart, pluginPrompt, ...claudeHooks];
    const listed = linkHookSpawns([
      entry(meta("claude-parent"), events),
      entry(codexExec("codex-child", "2026-10-21T06:21:20.759Z")),
    ]);
    const [parentMeta] = listed;
    if (!parentMeta) throw new Error("expected meta");
    const read = withHookSpawnLinks({ ...parentMeta, events }, parentMeta, listed, ruleOf);
    expect(read.events.map((e) => e.spawnedSessions?.length ?? 0)).toEqual([0, 0, 1]);
  });

  it("with no hook still running, marks the hook that ended last (a detached launch)", () => {
    // Live run 72182899: PreToolUse ended 32.769, the launching PostToolUse 32.850.
    const pre = hook("2026-10-21T06:30:32.769Z", 289);
    const post = hook("2026-10-21T06:30:32.850Z", 4);
    const listed = linkHookSpawns([
      entry(meta("parent"), [pre, post]),
      entry(codexExec("codex-child", "2026-10-21T06:30:35.090Z")),
    ]);
    const [parentMeta] = listed;
    if (!parentMeta) throw new Error("expected meta");
    const read = withHookSpawnLinks({ ...parentMeta, events: [pre, post] }, parentMeta, listed, ruleOf);
    expect(read.events.map((e) => e.spawnedSessions?.length ?? 0)).toEqual([0, 1]);
  });

  it("does not mark a same-id session of another agent as this session's child", () => {
    // parentId alone is not enough: the child's parentAgent must match too.
    const listed = linkHookSpawns([
      entry(meta("claude-parent", { agent: "codex" })), // same id, other agent
      entry(meta("claude-parent"), claudeHooks),
      entry(codexExec("codex-child", "2026-10-21T06:21:20.759Z")),
    ]);
    const codexSame = listed[0];
    if (!codexSame) throw new Error("expected meta");
    const read = withHookSpawnLinks({ ...codexSame, events: claudeHooks }, codexSame, listed, ruleOf);
    expect(read.events[0]?.spawnedSessions).toBeUndefined();
  });
});

describe("hook-spawn lineage end to end (fixtures trimmed from a live claude -p → codex exec run)", () => {
  const overrides = {
    "claude-code": fileURLToPath(new URL("./fixtures/lineage/claude", import.meta.url)),
    codex: fileURLToPath(new URL("./fixtures/lineage/codex/sessions", import.meta.url)),
  };
  const PARENT = "20c73300-0c24-4716-8d6e-456609d3fcc8";
  const CHILD = "01a15d23-7e61-7af1-b851-632ba7f584d4";

  it("links only the codex exec started inside the Claude hook, across agents", async () => {
    const byId = new Map((await listLinkedSessions(overrides)).map((m) => [m.id, m]));
    expect(byId.get(CHILD)).toMatchObject({ parentId: PARENT, parentAgent: "claude-code", parentInferred: true });
    expect(byId.get("01a15d23-0000-7000-8000-00000000c0de")?.parentId).toBeUndefined(); // TUI
    expect(byId.get("01a15d24-0000-7000-8000-00000000la7e")?.parentId).toBeUndefined(); // too late
    expect(byId.get(PARENT)).not.toHaveProperty("hookWindows");
  });

  it("keeps the link when the listing is narrowed to the child's agent", async () => {
    const [child] = (await findAllSessions(["codex"], overrides)).filter((m) => m.id === CHILD);
    expect(child?.parentId).toBe(PARENT);
  });

  it("marks only the launching hook row on the parent's read, not the plugin hook in the slack", async () => {
    const parent = await resolveSession(PARENT, ["claude-code"], overrides);
    const marked = (parent?.events ?? []).filter((e) => e.spawnedSessions?.length);
    expect(marked.map((e) => e.command)).toEqual([expect.stringContaining("codex exec")]);
    expect(marked[0]?.spawnedSessions).toEqual([{ id: CHILD, agent: "codex", inferred: true }]);
    const child = await resolveSession(CHILD, ["codex"], overrides);
    expect(child).toMatchObject({ parentId: PARENT, parentAgent: "claude-code", parentInferred: true });
  });
});
