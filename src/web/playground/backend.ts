import type { Agent, Filters, ImportMode, Session, SessionHit, SessionMeta } from "../lib/api.js";
import { findAllSessions, resolveSession } from "../../core/adapters/index.js";
import { matchingSessionRefs, searchSessionHits } from "../../core/search.js";
import { aggregateUsage, costForModel, usageSum } from "../../core/cost.js";
import { mask as maskText, maskValue } from "../../core/mask.js";
import { assertBundle } from "../../core/bundle.js";
import { buildClaudeSession } from "../../core/adapters/claude-code.js";
import { buildCodexSession } from "../../core/adapters/codex.js";
import { parseJsonlText } from "../../core/jsonl-parse.js";
import { playgroundPrices } from "./prices.js";
import { playgroundPlugins } from "./plugins.js";
import { addImported, allSessions, idsInCollection, importedSessions, nativeFiles } from "./data.js";
import { registerPlaygroundAdapters } from "./browser-adapters.js";

registerPlaygroundAdapters();

const resolve = playgroundPrices;
const plugin = playgroundPlugins;

/** The plugin that spawned an SDK session, matched on its prompt's first line —
 *  same gate as the server (only programmatic sdk sessions). */
function spawnerOf(meta: { programmatic?: boolean; origin?: string }, text: string | undefined): string | undefined {
  if (!meta.programmatic || !meta.origin?.startsWith("sdk") || !text) return undefined;
  return plugin.forPrompt(text);
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

export async function apiFacets(): Promise<{ tools: string[]; cwds: string[]; models: string[] }> {
  const tools = new Set<string>();
  const cwds = new Set<string>();
  const models = new Set<string>();
  for (const s of allSessions()) {
    if (s.cwd) cwds.add(s.cwd);
    for (const m of s.models ?? (s.model ? [s.model] : [])) models.add(m);
    for (const e of s.events) if (e.kind === "tool_use" && e.tool) tools.add(e.tool);
  }
  return { tools: [...tools].sort(), cwds: [...cwds].sort(), models: [...models].sort() };
}

export async function apiSources(): Promise<{ name: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const s of importedSessions()) {
    const name = s.importedFrom ?? "imported";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function apiSessions(f: Partial<Filters>): Promise<SessionMeta[]> {
  const sessions = await findAllSessions(
    f.agents,
    {},
    {
      archived: f.archived,
      programmatic: f.programmatic,
      models: f.models,
      source: f.source || undefined,
    },
  );
  const projs = (f.cwds ?? []).map((p) => p.toLowerCase());
  const matched = projs.length
    ? sessions.filter((m) => projs.some((p) => (m.cwd ?? "").toLowerCase().includes(p)))
    : sessions;
  return matched.map((m) => {
    const spawnedBy = spawnerOf(m, m.title);
    return spawnedBy ? { ...m, spawnedBy } : m;
  });
}

export async function apiSession(agent: Agent, id: string, mask: boolean): Promise<Session> {
  const sess = await resolveSession(id, [agent]);
  if (!sess) throw new Error("session not found");
  const out = mask ? maskSession(sess) : sess;
  const events = out.events.map((e) => {
    if (e.usage) return { ...e, tokens: usageSum(e.usage), cost: costForModel(e.usage, e.model, resolve) };
    if (e.kind === "hook" && e.command) return { ...e, plugin: plugin.forCommand(e.command) };
    return e;
  });
  const firstUser = out.events.find((e) => e.kind === "text" && e.role === "user" && e.text)?.text;
  const spawnedBy = spawnerOf(out, firstUser);
  return { ...out, events, usage: aggregateUsage(out.events, resolve), spawnedBy };
}

export async function apiSearch(f: Filters, limit: number): Promise<SessionHit[]> {
  const hits = await searchSessionHits({
    pattern: f.q,
    agents: f.agents,
    tools: f.tools,
    models: f.models,
    cwds: f.cwds,
    source: f.source || undefined,
    since: f.since,
    until: f.until,
    kinds: f.kinds,
    archived: f.archived,
    programmatic: f.programmatic,
    mask: f.mask,
    limit,
    overrides: {},
  });
  return hits.map((h) => {
    const spawnedBy = spawnerOf(h, h.title);
    return spawnedBy ? { ...h, spawnedBy } : h;
  });
}

export async function apiExport(filters?: Filters): Promise<Blob> {
  const selection = filters
    ? await matchingSessionRefs({
        pattern: filters.q,
        agents: filters.agents,
        tools: filters.tools,
        models: filters.models,
        cwds: filters.cwds,
        source: filters.source || undefined,
        since: filters.since,
        until: filters.until,
        kinds: filters.kinds,
        archived: filters.archived,
        programmatic: filters.programmatic,
        overrides: {},
      })
    : undefined;
  const files = nativeFiles
    .filter((file) => !selection || selection.some((s) => s.agent === file.agent && s.path === file.path))
    .map((file) => ({ agent: file.agent, rel: file.rel, content: file.content }));
  const bundle = { agtailExport: 1, created: new Date().toISOString(), files };
  return new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
}

export async function apiImport(
  bundleText: string,
  opts: { mode: ImportMode; overwrite: boolean; collection?: string },
): Promise<{ written: number; skipped: number }> {
  const bundle: unknown = JSON.parse(bundleText);
  assertBundle(bundle);
  // No real agent dirs in the browser: both destinations land in an in-memory
  // collection. "native" mode is shown as the "native" collection.
  const collection = opts.mode === "agtail" ? opts.collection || "imported" : "native";
  const existing = idsInCollection(collection);
  const counts = { written: 0, skipped: 0 };
  const toAdd: Session[] = [];
  for (const file of bundle.files) {
    const lines = parseJsonlText(file.content);
    // A codex session's real id comes from its session_meta (not the filename),
    // so parse first, then dedup on the session's actual id.
    const fallbackId = file.rel.replace(/.*\//, "").replace(/\.jsonl$/, "");
    const path = `imported:/${collection}/${file.rel}`;
    const parsed =
      file.agent === "codex"
        ? buildCodexSession(lines, { id: fallbackId, path, mtime: 0 })
        : buildClaudeSession(lines, { id: fallbackId, path, mtime: 0 });
    if (!opts.overwrite && existing.has(parsed.id)) {
      counts.skipped++;
      continue;
    }
    toAdd.push({
      ...parsed,
      mtime: Date.parse(parsed.ended ?? parsed.started ?? "") || 0,
      imported: true,
      importedFrom: collection,
    });
    existing.add(parsed.id);
    counts.written++;
  }
  addImported(toAdd);
  return counts;
}
