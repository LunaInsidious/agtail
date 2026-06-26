import type { IncomingMessage, ServerResponse } from "node:http";
import type { Agent, ArchivedFilter, AutomatedFilter, EventKind, Session } from "../core/types.js";
import { AGENTS } from "../core/types.js";
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
  const items = v.split(",").map((s) => s.trim()).filter((s) => AGENTS.includes(s as Agent));
  return items.length ? (items as Agent[]) : undefined;
}

function parseArchived(v: string | null): ArchivedFilter {
  return v === "only" || v === "none" ? v : "all";
}

function parseAutomated(v: string | null): AutomatedFilter {
  return v === "only" || v === "none" ? v : "all";
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
  let facets: Promise<{ tools: string[]; cwds: string[]; models: string[] }> | null = null;
  // LiteLLM price sheet, loaded once.
  let prices: ReturnType<typeof loadPriceResolver> | null = null;

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
          parseAutomated(q.get("automated")),
          q.getAll("model").filter(Boolean),
        );
        const proj = q.get("project")?.toLowerCase();
        sendJson(200, proj ? sessions.filter((m) => (m.cwd ?? "").toLowerCase().includes(proj)) : sessions);
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
        const resolve = await (prices ??= loadPriceResolver());
        // Attach per-turn tokens/cost to events that carry usage.
        const events = out.events.map((e) =>
          e.usage ? { ...e, tokens: usageSum(e.usage), cost: costForModel(e.usage, e.model, resolve) } : e,
        );
        sendJson(200, { ...out, events, usage: aggregateUsage(out.events, resolve) });
        return true;
      }
      if (url.pathname === "/api/facets") {
        facets ??= computeFacets(ov);
        sendJson(200, await facets);
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
          cwd: q.get("cwd") ?? undefined,
          since: q.get("since") ?? undefined,
          until: q.get("until") ?? undefined,
          kinds: (q.get("kind")?.split(",").filter(Boolean) as EventKind[]) || undefined,
          archived: parseArchived(q.get("archived")),
          automated: parseAutomated(q.get("automated")),
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
