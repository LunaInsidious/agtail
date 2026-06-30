import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Static, server-less build of the SPA for GitHub Pages. The app talks to an
// in-browser backend (main.playground.tsx injects it) over bundled sample data,
// so there's no /api middleware here. node:* specifiers are aliased to browser
// shims because the bundled parsers' modules reference them (but never call them
// at runtime — see src/web/playground/shims).
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("./src/web"),
  base: "/agtail/playground/",
  resolve: {
    alias: {
      "node:fs/promises": here("./src/web/playground/shims/fs-promises.ts"),
      "node:fs": here("./src/web/playground/shims/fs.ts"),
      "node:os": here("./src/web/playground/shims/os.ts"),
      "node:path": here("./src/web/playground/shims/path.ts"),
      "node:readline": here("./src/web/playground/shims/readline.ts"),
    },
  },
  plugins: [react()],
  build: {
    outDir: here("./dist-playground"),
    emptyOutDir: true,
    rollupOptions: { input: here("./src/web/index.playground.html") },
  },
});
