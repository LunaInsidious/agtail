import type { IncomingMessage, ServerResponse } from "node:http";
import type { Agent, ArchivedFilter, ProgrammaticFilter, Session } from "../core/types.js";
import { isAgent, isEventKind } from "../core/types.js";
import type { RootOverrides } from "../core/adapters/types.js";
import { findAllSessions, resolveSession, selectAdapters } from "../core/adapters/index.js";
import { searchSessionHits } from "../core/search.js";
import { aggregateUsage, costForModel, usageSum } from "../core/cost.js";
import { loadPriceResolver } from "../core/pricing.js";
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

export function createApiHandler(opts: ApiOptions = {}) {
  const ov = opts.overrides ?? {};
  const defaultLimit = opts.searchLimit ?? 500;
  // Facets are a full scan, so compute once and cache for the process lifetime.
  const getFacets = once(() => computeFacets(ov));
  // LiteLLM price sheet, loaded once.

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
        const sessions = await findAllSessions(
          parseAgents(q.get("agent")),
          ov,
          parseArchived(q.get("archived")),
          parseProgrammatic(q.get("programmatic")),
          q.getAll("model").filter(Boolean),
        );
        const projs = q
          .getAll("project")
          .filter(Boolean)
          .map((p) => p.toLowerCase());
        sendJson(
          200,
          projs.length ? sessions.filter((m) => projs.some((p) => (m.cwd ?? "").toLowerCase().includes(p))) : sessions,
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
        // Attach per-turn tokens/cost to events that carry usage.
        const events = out.events.map((e) =>
          e.usage ? { ...e, tokens: usageSum(e.usage), cost: costForModel(e.usage, e.model, resolve) } : e,
        );
        sendJson(200, { ...out, events, usage: aggregateUsage(out.events, resolve) });
        return true;
      }
      if (url.pathname === "/api/facets") {
        sendJson(200, await getFacets());
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
          since: q.get("since") ?? undefined,
          until: q.get("until") ?? undefined,
          kinds: q.get("kind")?.split(",").filter(isEventKind) || undefined,
          archived: parseArchived(q.get("archived")),
          programmatic: parseProgrammatic(q.get("programmatic")),
          mask: q.get("mask") === "1" || Boolean(opts.mask),
          limit: q.get("limit") ? Number(q.get("limit")) : defaultLimit,
          overrides: ov,
        });
        sendJson(200, matches);
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
