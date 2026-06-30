import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (which roots at src/web for the SPA build).
export default defineConfig({
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
  },
});
