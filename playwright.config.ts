import { defineConfig } from "@playwright/test";

// E2E covers what only a real browser + server can: the served SPA + /api,
// URL routing (/saved), browser Back/forward, localStorage and real keyboard
// input. Pure logic stays in the Vitest unit tests. The server is pointed at
// the deterministic test fixtures, and we use the system Chrome (no download).
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4599",
    channel: "chrome",
  },
  webServer: {
    command:
      "npx vite build && npx tsx src/cli/index.ts serve --port 4599 --claude-dir test/fixtures --codex-dir test/fixtures",
    url: "http://127.0.0.1:4599",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
