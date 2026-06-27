import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

// Run the CLI as a subprocess against the deterministic fixtures (the same ones
// the e2e server uses). This covers argument parsing plus the list/grep/show
// commands end-to-end — the unit tests only reach the pure core, not the CLI.
const run = (...args: string[]): string => {
  const out = execFileSync(
    "node_modules/.bin/tsx",
    ["src/cli/index.ts", ...args, "--claude-dir", "test/fixtures", "--codex-dir", "test/fixtures"],
    { encoding: "utf8" },
  );
  // Strip ANSI colour codes so assertions match plain text regardless of TTY.
  return out.replace(/\[[0-9;]*m/g, "");
};

describe("cli", () => {
  test("list shows sessions with cwd, event counts and programmatic markers", () => {
    const out = run("list");
    expect(out).toContain("/Users/testuser/proj");
    expect(out).toContain("claude-desktop"); // programmatic origin label
    expect(out).toMatch(/\d+ ev/); // the event-count column
  });

  test("grep finds a content match across agents", () => {
    const out = run("grep", "blogsync");
    expect(out).toContain("blogsync");
    expect(out).toContain("codex"); // the codex fixture mentions blogsync
  });

  test("show prints a session header and its timeline", () => {
    const out = run("show", "claude-programmatic");
    expect(out).toContain("sdk-py"); // programmatic origin
    expect(out).toContain("claude-opus-4-7"); // model from the header
    expect(out).toContain("No issues found."); // assistant message body
  });
});
