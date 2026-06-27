/**
 * Architecture gate. Encodes the layer boundaries the codebase already follows
 * so they stay enforced: no cycles, no stranded files, and a one-way dependency
 * direction between core / server / cli / web (and within web: lib ← components
 * / hooks ← App, never the reverse).
 *
 * Run: `pnpm depcruise`  (also part of `pnpm check`).
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make modules impossible to reason about (and load) in isolation.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "A module imported by nothing is usually dead code (entry points and types are exempted).",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "src/web/main\\.tsx$", // SPA entry
          "src/cli/index\\.ts$", // CLI entry
          "(^|/)[^/]+\\.config\\.[cm]?[jt]s$", // vite/tsup/etc configs
        ],
      },
      to: {},
    },
    {
      name: "core-is-the-base",
      severity: "error",
      comment: "core is the shared domain layer — it must not reach up into web, server or cli.",
      from: { path: "^src/core/" },
      to: { path: "^src/(web|server|cli)/" },
    },
    {
      name: "web-is-browser-only",
      severity: "error",
      comment:
        "Browser code must not import core/server/cli (all Node-side). It mirrors the few types it needs (web/lib/api.ts) and talks to the server over HTTP, so the bundle never pulls in node:fs/path etc. This is also why summarizeInput is duplicated in web rather than imported from core.",
      from: { path: "^src/web/" },
      to: { path: "^src/(core|server|cli)/" },
    },
    {
      name: "node-layers-no-web",
      severity: "error",
      comment: "server and cli are Node entry points — they must not import browser/web modules.",
      from: { path: "^src/(server|cli)/" },
      to: { path: "^src/web/" },
    },
    {
      name: "web-lib-is-pure",
      severity: "error",
      comment:
        "web/lib is non-React shared logic (api/state/filters/util) — it must not depend on React UI (components/hooks) or the App container.",
      from: { path: "^src/web/lib/" },
      to: { path: "^src/web/(components|hooks|App\\.tsx)" },
    },
    {
      name: "no-back-edge-to-app",
      severity: "error",
      comment:
        "components and hooks sit below the App container — nothing they import should reach back up into App.tsx.",
      from: { path: "^src/web/(components|hooks)/" },
      to: { path: "^src/web/App\\.tsx$" },
    },
    {
      name: "presentational-components-stay-pure",
      severity: "error",
      comment:
        "Presentational components take props; the App-level orchestration hooks (useOpenSession etc.) are wired in App, not reached into from a component.",
      from: { path: "^src/web/components/" },
      to: { path: "^src/web/hooks/" },
    },
    {
      name: "no-src-to-test",
      severity: "error",
      comment: "Production code under src/ must never import test code.",
      from: { path: "^src/" },
      to: { path: "^(test|e2e)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
