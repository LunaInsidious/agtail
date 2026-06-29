import type { IncomingMessage, ServerResponse } from "node:http";
import type { Agent, ArchivedFilter, ProgrammaticFilter, Session } from "../core/types.js";
import { AGENTS, isAgent, isEventKind } from "../core/types.js";
import type { RootOverrides } from "../core/adapters/types.js";
import { findAllSessions, resolveSession, selectAdapters } from "../core/adapters/index.js";
import { collectionDir, listCollections } from "../core/imported.js";
import { walkFiles } from "../core/walk.js";
import type { SearchFilters } from "../core/search.js";
import { matchingSessionRefs, searchSessionHits } from "../core/search.js";
import { aggregateUsage, costForModel, usageSum } from "../core/cost.js";
import { loadPriceResolver } from "../core/pricing.js";
import type { PluginResolver } from "../core/plugins.js";
import { loadPluginResolver } from "../core/plugins.js";
import { assertBundle, exportSessions, importSessions } from "../core/transfer.js";
import { isRecord } from "../core/utils.js";
import { mask as maskText, maskValue } from "../core/mask.js";

export interface ApiOptions {
  overrides?: RootOverrides;
  mask?: boolean;
  searchLimit?: number;
}

function parseAgents(v: string | null): Agent[] | undefined {
  if (!v) return undefined;
  const items = v
    .split(",")
    .map((s) => s.trim())
    .filter(isAgent);
  return items.length ? items : undefined;
}

function parseArchived(v: string | null): ArchivedFilter {
  return v === "only" || v === "none" ? v : "all";
}

function parseProgrammatic(v: string | null): ProgrammaticFilter {
  return v === "only" || v === "none" ? v : "all";
}

/** Memoize a zero-arg factory: the first call runs it, later calls reuse the
 *  same result (so a cached promise is computed exactly once). */
function once<T>(factory: () => T): () => T {
  const cache: { box?: { value: T } } = {};
  return () => {
    const box = cache.box ?? { value: factory() };
    cache.box = box;
    return box.value;
  };
}

function maskSession(s: Session): Session {
  return {
    ...s,
    title: maskText(s.title, true),
    events: s.events.map((e) => ({
      ...e,
      text: e.text != null ? maskText(e.text, true) : e.text,
      input: e.input != null ? maskValue(e.input) : e.input,
      result: e.result ? { ...e.result, text: maskText(e.result.text, true) } : e.result,
    })),
  };
}

/**
 * Build an /api/* request handler shared by the production server (node:http)
 * and the Vite dev server (connect middleware). Returns true if it handled the
 * request (i.e. the path started with /api/), false to defer to static/SPA.
 */
/** Distinct tool names + cwds across all sessions, for selectable filters. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- full-scan facet collector: nested loops over adapters → sessions → events to gather distinct tools/cwds/models.
async function computeFacets(ov: RootOverrides): Promise<{ tools: string[]; cwds: string[]; models: string[] }> {
  const tools = new Set<string>();
  const cwds = new Set<string>();
  const models = new Set<string>();
  for (const a of selectAdapters(undefined, ov)) {
    const metas = await a.findSessions();
    for (const m of metas) {
      if (m.cwd) cwds.add(m.cwd);
      for (const mm of m.models ?? (m.model ? [m.model] : [])) models.add(mm);
    }
    const sessions = await Promise.all(metas.map((m) => a.readSession(m.path)));
    for (const s of sessions) for (const e of s.events) if (e.kind === "tool_use" && e.tool) tools.add(e.tool);
  }
  return { tools: [...tools].sort(), cwds: [...cwds].sort(), models: [...models].sort() };
}

/** The plugin that spawned an SDK session, by matching its prompt to a plugin's
 *  review-prompt template. `text` is the session's first user prompt (or, for the
 *  list where events aren't loaded, its title). Only for programmatic SDK sessions. */
function spawnerOf(
  meta: { programmatic?: boolean; origin?: string },
  text: string | undefined,
  plugin: PluginResolver,
) {
  if (!meta.programmatic || !meta.origin?.startsWith("sdk") || !text) return undefined;
  return plugin.forPrompt(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

const isJsonlFile = (n: string) => n.endsWith(".jsonl");

/** The import collections (one per synced person/machine) with a session-file
 *  count each, for the header source switcher. Counts files only (no parse), so
 *  it's cheap enough to recompute on every load and after an import. */
async function listSources(): Promise<{ name: string; count: number }[]> {
  return Promise.all(
    listCollections().map(async (name) => {
      const perAgent = await Promise.all(
        AGENTS.map((a) => walkFiles(collectionDir(name, a), isJsonlFile).then((f) => f.length)),
      );
      return { name, count: perAgent.reduce((sum, n) => sum + n, 0) };
    }),
  );
}

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const optStr = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Build search filters from an untrusted export-request body's `filters` object,
 *  or null when none is present (= export everything). The same filter dimensions
 *  the UI applies, re-run server-side and UNBOUNDED so nothing is dropped. */
function parseExportFilters(body: unknown): SearchFilters | null {
  if (!isRecord(body) || !isRecord(body.filters)) return null;
  const f = body.filters;
  const agents = strArray(f.agents).filter(isAgent);
  return {
    pattern: optStr(f.q),
    agents: agents.length ? agents : undefined,
    tools: strArray(f.tools),
    models: strArray(f.models),
    cwds: strArray(f.cwds),
    source: optStr(f.source),
    since: optStr(f.since),
    until: optStr(f.until),
    kinds: strArray(f.kinds).filter(isEventKind),
    archived: parseArchived(optStr(f.archived) ?? null),
    programmatic: parseProgrammatic(optStr(f.programmatic) ?? null),
  };
}

export function createApiHandler(opts: ApiOptions = {}) {
  const ov = opts.overrides ?? {};
  const defaultLimit = opts.searchLimit ?? 500;
  // Facets are a full scan, so compute once and cache for the process lifetime.
  const getFacets = once(() => computeFacets(ov));

  // eslint-disable-next-line sonarjs/cognitive-complexity -- HTTP route dispatcher: one branch per endpoint; breadth, not nesting depth.
  return async function api(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/")) return false;
    const q = url.searchParams;
    const sendJson = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    };

    try {
      if (url.pathname === "/api/sessions") {
        const sessions = await findAllSessions(parseAgents(q.get("agent")), ov, {
          archived: parseArchived(q.get("archived")),
          programmatic: parseProgrammatic(q.get("programmatic")),
          models: q.getAll("model").filter(Boolean),
          source: q.get("source") || undefined,
        });
        const projs = q
          .getAll("project")
          .filter(Boolean)
          .map((p) => p.toLowerCase());
        const matched = projs.length
          ? sessions.filter((m) => projs.some((p) => (m.cwd ?? "").toLowerCase().includes(p)))
          : sessions;
        // Tag SDK-spawned sessions with the plugin behind them (matched on the
        // title, which is the prompt's first line). Cheap; the index is cached.
        const plugin = await loadPluginResolver();
        sendJson(
          200,
          matched.map((m) => {
            const spawnedBy = spawnerOf(m, m.title, plugin);
            return spawnedBy ? { ...m, spawnedBy } : m;
          }),
        );
        return true;
      }
      if (url.pathname === "/api/session") {
        const id = q.get("id") ?? "";
        const doMask = q.get("mask") === "1" || Boolean(opts.mask);
        const sess = await resolveSession(id, parseAgents(q.get("agent")), ov);
        if (!sess) {
          sendJson(404, { error: "not found" });
          return true;
        }
        const out = doMask ? maskSession(sess) : sess;
        // Pass the session's models so a brand-new one triggers a price refresh.
        const resolve = await loadPriceResolver(out.models ?? (out.model ? [out.model] : []));
        // Resolve which plugin each hook's command belongs to (local install only).
        const plugin = await loadPluginResolver();
        // Attach per-turn tokens/cost to usage events, and the plugin to hooks.
        const events = out.events.map((e) => {
          if (e.usage) return { ...e, tokens: usageSum(e.usage), cost: costForModel(e.usage, e.model, resolve) };
          if (e.kind === "hook" && e.command) return { ...e, plugin: plugin.forCommand(e.command) };
          return e;
        });
        const firstUser = out.events.find((e) => e.kind === "text" && e.role === "user" && e.text)?.text;
        const spawnedBy = spawnerOf(out, firstUser, plugin);
        sendJson(200, { ...out, events, usage: aggregateUsage(out.events, resolve), spawnedBy });
        return true;
      }
      if (url.pathname === "/api/facets") {
        sendJson(200, await getFacets());
        return true;
      }
      if (url.pathname === "/api/sources") {
        sendJson(200, await listSources());
        return true;
      }
      if (url.pathname === "/api/search") {
        const matches = await searchSessionHits({
          pattern: q.get("q") ?? undefined,
          regex: q.get("regex") === "1",
          ignoreCase: q.get("case") !== "1",
          agents: parseAgents(q.get("agent")),
          tools: q.getAll("tool").filter(Boolean),
          models: q.getAll("model").filter(Boolean),
          cwds: q.getAll("cwd").filter(Boolean),
          source: q.get("source") || undefined,
          since: q.get("since") ?? undefined,
          until: q.get("until") ?? undefined,
          kinds: q.get("kind")?.split(",").filter(isEventKind) || undefined,
          archived: parseArchived(q.get("archived")),
          programmatic: parseProgrammatic(q.get("programmatic")),
          mask: q.get("mask") === "1" || Boolean(opts.mask),
          limit: q.get("limit") ? Number(q.get("limit")) : defaultLimit,
          overrides: ov,
        });
        // Tag SDK-spawned hits with their plugin (matched on the title), so the
        // Results list shows it just like the browse list does.
        const plugin = await loadPluginResolver();
        sendJson(
          200,
          matches.map((h) => {
            const spawnedBy = spawnerOf(h, h.title, plugin);
            return spawnedBy ? { ...h, spawnedBy } : h;
          }),
        );
        return true;
      }
      if (url.pathname === "/api/export") {
        // GET (or empty POST) exports everything; a POST {filters:{…}} body
        // re-runs those filters unbounded and exports only the matching sessions.
        const body = req.method === "POST" ? await readBody(req) : "";
        const filters = parseExportFilters(body ? JSON.parse(body) : undefined);
        const selection = filters ? await matchingSessionRefs({ ...filters, overrides: ov }) : undefined;
        sendJson(200, await exportSessions({ agents: parseAgents(q.get("agent")), selection }, ov));
        return true;
      }
      if (url.pathname === "/api/import") {
        const bundle = JSON.parse(await readBody(req));
        assertBundle(bundle);
        // Destination is the caller's choice (the UI confirms it): "agtail" =
        // view-only store (audit), "native" = the real agent dirs (migration).
        // Default to the safe view-only store on anything unrecognized. The
        // server is 127.0.0.1-only, so this stays a local, operator-driven write.
        const mode = q.get("mode") === "native" ? "native" : "agtail";
        // The collection groups an agtail import (one per synced person/machine);
        // importSessions sanitizes it. Ignored for native.
        const collection = q.get("collection") || undefined;
        const result = await importSessions(bundle, { mode, overwrite: q.get("overwrite") === "1", collection }, ov);
        sendJson(200, result);
        return true;
      }
      sendJson(404, { error: "unknown endpoint" });
      return true;
    } catch (err) {
      sendJson(500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  };
}
