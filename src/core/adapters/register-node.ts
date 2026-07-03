import { registerAdapters } from "./index.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";

// Node-only: registers the in-tree filesystem adapters. Imported by the CLI, the
// server, and the test setup — never by the browser bundle (which would pull in
// node:fs). Idempotent: re-registering the same set is harmless. Adding an agent
// = add its adapter here (see docs/guide/adapters.md).
export function registerNodeAdapters(): void {
  registerAdapters((overrides) => [claudeCodeAdapter(overrides["claude-code"]), codexAdapter(overrides["codex"])]);
}
