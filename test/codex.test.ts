import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { buildCodexSession, codexAdapter } from "../src/core/adapters/codex.js";
import { obj } from "../src/core/utils.js";

const msg = (type: string, extra: Record<string, unknown> = {}) => ({
  timestamp: "2026-07-02T10:00:00Z",
  type: "event_msg",
  payload: { type, ...extra },
});

const fixture = fileURLToPath(new URL("./fixtures/rollout-codex-test.jsonl", import.meta.url));
const forkFixture = fileURLToPath(new URL("./fixtures/rollout-codex-fork.jsonl", import.meta.url));

describe("codex adapter", () => {
  it("normalizes the event_msg stream (not response_item noise)", async () => {
    const sess = await codexAdapter().readSession(fixture);
    expect(sess.agent).toBe("codex");
    expect(sess.cwd).toBe("/Users/testuser/proj");
    expect(sess.model).toBe("gpt-5.5");
    expect(sess.version).toBe("0.142.0");
    expect(sess.title).toBe("run the build for blogsync");

    const kinds = sess.events.map((e) => e.kind);
    // developer system-prompt noise from response_item must not leak in.
    expect(sess.events.some((e) => e.text?.includes("system prompt noise"))).toBe(false);
    expect(kinds).toContain("text");
    expect(kinds).toContain("thinking");
    expect(kinds).toContain("tool_use");
  });

  it("maps response_item function_call/output into one tool_use with a result", async () => {
    const sess = await codexAdapter().readSession(fixture);
    const exec = sess.events.find((e) => e.kind === "tool_use" && e.tool === "exec");
    expect(exec).toBeDefined();
    const input = obj(exec?.input);
    expect(input.command).toBe("npm run build");
    expect(input.cwd).toBe("/Users/testuser/proj");
    expect(exec?.result?.isError).toBe(false);
    expect(exec?.result?.text).toContain("build ok");
  });

  it("attaches token usage to the assistant turn (cached excluded from input)", async () => {
    const sess = await codexAdapter().readSession(fixture);
    const withUsage = sess.events.find((e) => e.usage);
    expect(withUsage?.usage?.inputTokens).toBe(800); // 1000 - 200 cached
    expect(withUsage?.usage?.cacheReadTokens).toBe(200);
    expect(withUsage?.usage?.outputTokens).toBe(50);
  });

  it("identifies a resumed/forked rollout by its own id, not the original session_id", async () => {
    // A fork records the original conversation in session_id but has its own id;
    // using session_id would collapse it onto (and duplicate) the original.
    const sess = await codexAdapter().readSession(forkFixture);
    expect(sess.id).toBe("fork-own-id");
  });

  it("preserves unrecognized events as unknown, but skips noise", async () => {
    const sess = await codexAdapter().readSession(fixture);
    expect(sess.events.some((e) => e.kind === "unknown" && e.text === "some_future_event")).toBe(true);
    // streaming deltas are skipped
    expect(sess.events.some((e) => e.text === "agent_reasoning_delta")).toBe(false);
    // response_item message (dup) and reasoning (encrypted) are not surfaced
    expect(sess.events.some((e) => e.text === "message" || e.text === "reasoning")).toBe(false);
    expect(sess.events.some((e) => JSON.stringify(e).includes("ENCRYPTEDNOISE"))).toBe(false);
  });
});

describe("codex termination", () => {
  const ctx = { id: "s", path: "p", mtime: 0 };

  it("flags interrupted when a turn started but never completed", () => {
    const sess = buildCodexSession(
      [
        msg("user_message", { message: "hi" }),
        msg("task_started", { turn_id: "t1" }),
        msg("agent_message", { message: "working" }),
      ],
      ctx,
    );
    expect(sess.termination).toBe("interrupted");
  });

  it("leaves termination unset when every turn completed", () => {
    const sess = buildCodexSession(
      [
        msg("task_started", { turn_id: "t1" }),
        msg("agent_message", { message: "done" }),
        msg("task_complete", { turn_id: "t1" }),
      ],
      ctx,
    );
    expect(sess.termination).toBeUndefined();
  });
});

describe("codex subagent linkage", () => {
  const ctx = { id: "s", path: "p", mtime: 0 };
  const item = (payload: Record<string, unknown>) => ({
    timestamp: "2026-07-02T10:00:00Z",
    type: "response_item",
    payload,
  });

  it("links a spawned thread to its parent via session_meta.parent_thread_id", () => {
    const sess = buildCodexSession(
      [
        {
          type: "session_meta",
          payload: {
            id: "child-id",
            session_id: "parent-id",
            parent_thread_id: "parent-id",
            agent_role: "explorer",
            originator: "codex-tui",
            source: { subagent: { thread_spawn: { parent_thread_id: "parent-id", depth: 1, agent_role: "explorer" } } },
          },
        },
        msg("user_message", { message: "read hoge.txt" }),
      ],
      ctx,
    );
    expect(sess.id).toBe("child-id");
    expect(sess.isSubagent).toBe(true);
    expect(sess.parentId).toBe("parent-id");
    expect(sess.agentName).toBe("explorer");
  });

  it("leaves a top-level thread unlinked", () => {
    const sess = buildCodexSession(
      [{ type: "session_meta", payload: { id: "x", source: "cli" } }, msg("user_message", { message: "hi" })],
      ctx,
    );
    expect(sess.isSubagent).toBeUndefined();
    expect(sess.parentId).toBeUndefined();
  });

  it("marks the parent's spawn_agent call with the child thread it returned", () => {
    const sess = buildCodexSession(
      [
        item({ type: "function_call", name: "spawn_agent", arguments: '{"agent_type":"explorer"}', call_id: "c1" }),
        item({ type: "function_call_output", call_id: "c1", output: '{"agent_id":"child-id","nickname":"Feynman"}' }),
        item({ type: "function_call", name: "exec_command", arguments: '{"cmd":"ls"}', call_id: "c2" }),
        item({ type: "function_call_output", call_id: "c2", output: "ok" }),
      ],
      ctx,
    );
    const [spawn, exec] = sess.events;
    expect(spawn?.spawnedSessions).toEqual([{ id: "child-id", agent: "codex" }]);
    expect(exec?.spawnedSessions).toBeUndefined();
  });
});
