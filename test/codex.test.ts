import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { codexAdapter } from "../src/core/adapters/codex.js";
import { obj } from "../src/core/utils.js";

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
