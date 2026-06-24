import { defineConfig } from "tsup";

// Builds the Node side (CLI + server). The web SPA is built separately by Vite.
export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Keep node built-ins external; bundle commander.
  banner: { js: "#!/usr/bin/env node" },
});
