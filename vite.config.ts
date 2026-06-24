import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { createApiHandler } from "./src/server/api.js";

const root = fileURLToPath(new URL("./src/web", import.meta.url));
const outDir = fileURLToPath(new URL("./dist-web", import.meta.url));

// Serve the /api/* endpoints from inside the Vite dev server so that
// `pnpm dev:web` is fully self-contained — no separate backend process.
function agtailApi(): Plugin {
  const api = createApiHandler({});
  return {
    name: "agtail-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        api(req, res)
          .then((handled) => {
            if (!handled) next();
          })
          .catch(next);
      });
    },
  };
}

export default defineConfig({
  root,
  base: "./",
  plugins: [react(), agtailApi()],
  build: {
    outDir,
    emptyOutDir: true,
  },
});
