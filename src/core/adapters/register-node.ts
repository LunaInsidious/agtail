import { registerAdapters } from "./index.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";

// Node-only: registers the filesystem adapters. Imported by the CLI, the server,
// and the test setup — never by the browser bundle (which would pull in node:fs).
// Idempotent: re-registering the same factory is harmless.
export function registerNodeAdapters(): void {
  registerAdapters((overrides) => [claudeCodeAdapter(overrides["claude-code"]), codexAdapter(overrides["codex"])]);
}
