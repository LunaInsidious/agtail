import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadPluginResolver, resetPluginCache } from "../src/core/plugins.js";

const pluginsDir = fileURLToPath(new URL("./fixtures/plugins", import.meta.url));
const env = { prev: process.env.AGTAIL_PLUGINS_DIR };

afterEach(() => {
  if (env.prev === undefined) delete process.env.AGTAIL_PLUGINS_DIR;
  else process.env.AGTAIL_PLUGINS_DIR = env.prev;
  resetPluginCache();
});

describe("loadPluginResolver", () => {
  it("maps a hook command to its plugin via the local plugin cache", async () => {
    process.env.AGTAIL_PLUGINS_DIR = pluginsDir;
    resetPluginCache();
    const resolve = await loadPluginResolver();
    // The command string from a transcript matches the plugin's hooks.json verbatim.
    expect(resolve.forCommand('bash "${CLAUDE_PLUGIN_ROOT}/hooks/sg-python.sh"')).toBe("security-guidance");
    expect(resolve.forCommand('bash "${CLAUDE_PLUGIN_ROOT}/scripts/session-start-hook.sh"')).toBe("security-guidance");
    // An unknown command (e.g. an imported session whose plugin isn't installed).
    expect(resolve.forCommand("some-other-command")).toBeUndefined();
  });

  it("attributes an SDK session to the plugin via its review-prompt template", async () => {
    process.env.AGTAIL_PLUGINS_DIR = pluginsDir;
    resetPluginCache();
    const resolve = await loadPluginResolver();
    // A spawned review session's prompt starts with the plugin's literal template.
    const prompt =
      "Review this change for security vulnerabilities.\n\nChanged files (you may Read these…):\n  - x.ts\n";
    expect(resolve.forPrompt(prompt)).toBe("security-guidance");
    // An ordinary human prompt matches nothing.
    expect(resolve.forPrompt("help me fix this bug in the parser")).toBeUndefined();
  });

  it("does NOT attribute when the first line is dynamic (deliberate: only the first line is trusted)", async () => {
    process.env.AGTAIL_PLUGINS_DIR = pluginsDir;
    resetPluginCache();
    const resolve = await loadPluginResolver();
    // First line is dynamic (a PR id), so it isn't in source. We intentionally do
    // NOT fall back to matching interior lines — an audit showed that misattributes
    // other plugins whose prompts share interior phrasing. Precision over recall.
    const prompt = [
      "Review PR #4242 on branch pr-260605135932 — dynamic header line here",
      "Changed files (you may Read these and any other file in the repo):",
      "  - src/x.ts",
    ].join("\n");
    expect(resolve.forPrompt(prompt)).toBeUndefined();
  });
});
