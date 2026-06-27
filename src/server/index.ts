import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RootOverrides } from "../core/adapters/types.js";
import { createApiHandler } from "./api.js";

export interface ServeOptions {
  port: number;
  overrides: RootOverrides;
  mask?: boolean;
}

/** Locate the built SPA (dist-web) by walking up from this module. */
function findWebRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "dist-web");
    if (existsSync(join(candidate, "index.html"))) return candidate;
    dir = dirname(dir);
  }
  throw new Error(
    "dist-web not found. Build the web UI first:  pnpm build  (then `agtail serve`).\n" +
      "For live UI development with no build step, use:  pnpm dev:web",
  );
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export async function startServer(opts: ServeOptions): Promise<void> {
  const webRoot = findWebRoot();
  const api = createApiHandler({ overrides: opts.overrides, mask: opts.mask });

  const server = createServer(async (req, res) => {
    try {
      if (await api(req, res)) return; // /api/* handled
      await serveStatic(webRoot, new URL(req.url ?? "/", "http://127.0.0.1").pathname, res);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });

  await new Promise<void>((ok) => server.listen(opts.port, "127.0.0.1", ok));
  console.log(`agtail viewer → http://127.0.0.1:${opts.port}   (web: ${webRoot})`);
  console.log("Stop with Ctrl-C");
}

async function serveStatic(webRoot: string, pathname: string, res: import("node:http").ServerResponse): Promise<void> {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const target = resolve(webRoot, "." + normalize(rel));
  // Path-traversal guard: must stay within webRoot.
  const file = target.startsWith(webRoot) && existsSync(target) ? target : join(webRoot, "index.html");
  const data = await readFile(file);
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(data);
}
