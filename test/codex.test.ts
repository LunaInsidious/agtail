import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { codexAdapter } from "../src/core/adapters/codex.js";

const fixture = fileURLToPath(new URL("./fixtures/rollout-codex-test.jsonl", import.meta.url));

describe("codex adapter", () => {
  it("normalizes the event_msg stream (not response_item noise)", async () => {
    const sess = await codexAdapter().readSession(fixture);
    expect(sess.agent).toBe("codex");
    expect(sess.cwd).toBe("/Users/itsuki_t/proj");
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
    expect((exec!.input as any).command).toBe("npm run build");
    expect((exec!.input as any).cwd).toBe("/Users/itsuki_t/proj");
    expect(exec!.result?.isError).toBe(false);
    expect(exec!.result?.text).toContain("build ok");
  });

  it("attaches token usage to the assistant turn (cached excluded from input)", async () => {
    const sess = await codexAdapter().readSession(fixture);
    const withUsage = sess.events.find((e) => e.usage);
    expect(withUsage?.usage?.inputTokens).toBe(800); // 1000 - 200 cached
    expect(withUsage?.usage?.cacheReadTokens).toBe(200);
    expect(withUsage?.usage?.outputTokens).toBe(50);
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
