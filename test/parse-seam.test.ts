import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { buildClaudeSession, claudeCodeAdapter } from "../src/core/adapters/claude-code.js";
import { buildCodexSession, codexAdapter } from "../src/core/adapters/codex.js";
import { parseJsonlText } from "../src/core/jsonl-parse.js";

// The pure, content-based parsers (used by the browser playground) must produce
// exactly what the filesystem readSession does — same lines in, same Session out.
describe("content parsers match the fs adapter", () => {
  it("buildClaudeSession equals claude readSession for the same transcript", async () => {
    const path = fileURLToPath(new URL("./fixtures/claude-session.jsonl", import.meta.url));
    const viaFs = await claudeCodeAdapter().readSession(path);
    const text = await readFile(path, "utf-8");
    const viaText = buildClaudeSession(parseJsonlText(text), { id: viaFs.id, path: viaFs.path, mtime: viaFs.mtime });
    expect(viaText).toEqual(viaFs);
  });

  it("buildCodexSession equals codex readSession for the same rollout", async () => {
    const path = fileURLToPath(new URL("./fixtures/rollout-codex-test.jsonl", import.meta.url));
    const viaFs = await codexAdapter().readSession(path);
    const text = await readFile(path, "utf-8");
    const viaText = buildCodexSession(parseJsonlText(text), { id: viaFs.id, path: viaFs.path, mtime: viaFs.mtime });
    expect(viaText).toEqual(viaFs);
  });
});
