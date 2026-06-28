import type {
  Agent,
  ArchivedFilter,
  ProgrammaticFilter,
  Event,
  EventKind,
  Match,
  Session,
  SessionHit,
} from "./types.js";
import { matchArchived, matchProgrammatic } from "./types.js";
import type { Adapter, RootOverrides } from "./adapters/types.js";
import { selectAdapters } from "./adapters/index.js";
import { toolSearchText } from "./format.js";
import { mask } from "./mask.js";
import { collect } from "./utils.js";

export interface SearchFilters {
  /** Text to match. Empty => match any event (filter-only search). */
  pattern?: string;
  /** Treat pattern as a regular expression (else literal substring). */
  regex?: boolean;
  /** Case-insensitive (default true). */
  ignoreCase?: boolean;
  agents?: Agent[];
  /** Tool name globs, e.g. "Bash", "Write", "mcp__*". Restricts to tool_use. */
  tools?: string[];
  /** Substring match against session cwd; matches if it contains ANY of these. */
  cwds?: string[];
  /** Restrict to sessions that used any of these models (membership). */
  models?: string[];
  /** ISO/date lower & upper bounds on event timestamp (inclusive). */
  since?: string;
  until?: string;
  /** Restrict to these event kinds. */
  kinds?: EventKind[];
  mask?: boolean;
  /** Treat archived sessions: include all (default), only, or exclude. */
  archived?: ArchivedFilter;
  /** Treat programmatic (SDK-driven) sessions: include all (default), only, exclude. */
  programmatic?: ProgrammaticFilter;
  /** Stop after this many matches (0/undefined = no limit). */
  limit?: number;
  overrides?: RootOverrides;
}

/** A session passes when it used any of the requested models (empty = all). */
function matchModels(meta: { models?: string[]; model?: string }, want?: string[]): boolean {
  if (!want?.length) return true;
  const used = meta.models ?? (meta.model ? [meta.model] : []);
  return want.some((m) => used.includes(m));
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function compilePattern(f: SearchFilters): RegExp | null {
  if (!f.pattern) return null;
  const flags = f.ignoreCase === false ? "g" : "gi";
  const src = f.regex ? f.pattern : f.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(src, flags);
}

/** Text that should be searched for a given event. */
function searchableText(e: Event): string {
  const parts: string[] = [];
  if (e.text) parts.push(e.text);
  if (e.kind === "tool_use") parts.push(toolSearchText(e.tool, e.input));
  if (e.result?.text) parts.push(e.result.text);
  return parts.join("\n");
}

function matchIndex(text: string, re: RegExp | null): number {
  if (!re) return 0;
  re.lastIndex = 0;
  return re.exec(text)?.index ?? 0;
}

function snippet(text: string, re: RegExp | null, doMask: boolean): string {
  const idx = matchIndex(text, re);
  const start = Math.max(0, idx - 60);
  const body = text
    .slice(start, idx + 120)
    .replace(/\s+/g, " ")
    .trim();
  const s = start > 0 ? "…" + body : body;
  return doMask ? mask(s, true) : s;
}

function inRange(ts: string | undefined, since?: string, until?: string): boolean {
  if (!since && !until) return true;
  if (!ts) return true; // undated events aren't excluded by a date window
  if (since && ts < since) return false;
  if (until && ts > until) return false;
  return true;
}

// Compiled filter state, shared by event-level and session-level search.
interface MatchCtx {
  re: RegExp | null;
  toolRes: RegExp[] | null;
  kinds: Set<EventKind> | null;
  since?: string;
  until?: string;
  cwdNeedles?: string[];
  doMask: boolean;
}

function buildCtx(f: SearchFilters): MatchCtx {
  return {
    re: compilePattern(f),
    // Empty arrays mean "no filter" (an empty [] is truthy — guard explicitly).
    toolRes: f.tools && f.tools.length ? f.tools.map(globToRegExp) : null,
    kinds: f.kinds && f.kinds.length ? new Set(f.kinds) : null,
    since: f.since,
    // A date-only `until` should include the whole day, not stop at 00:00:00.
    until: f.until && /^\d{4}-\d{2}-\d{2}$/.test(f.until) ? f.until + "T23:59:59.999Z" : f.until,
    cwdNeedles: f.cwds && f.cwds.length ? f.cwds.map((c) => c.toLowerCase()) : undefined,
    doMask: Boolean(f.mask),
  };
}

/** If the event passes all filters, return its searchable text (for snippeting);
 *  otherwise null. */
function matchHay(e: Event, ctx: MatchCtx): string | null {
  if (ctx.toolRes) {
    const tool = e.tool;
    if (e.kind !== "tool_use" || !tool) return null;
    if (!ctx.toolRes.some((r) => r.test(tool))) return null;
  }
  if (ctx.kinds && !ctx.kinds.has(e.kind)) return null;
  if (!inRange(e.ts, ctx.since, ctx.until)) return null;
  const hay = searchableText(e);
  if (ctx.re) {
    ctx.re.lastIndex = 0;
    if (!ctx.re.test(hay)) return null;
  } else if (!hay && e.kind !== "tool_use") {
    return null;
  }
  return hay;
}

const cwdMatches = (cwd: string | undefined, needles?: string[]) =>
  !needles || !needles.length || needles.some((n) => (cwd ?? "").toLowerCase().includes(n));

/** Read a session, returning null if it can't be parsed (a broken transcript
 *  shouldn't abort the whole scan). */
async function tryReadSession(adapter: Adapter, path: string): Promise<Session | null> {
  try {
    return await adapter.readSession(path);
  } catch {
    return null;
  }
}

/** Stream event-level matches across the selected agents' sessions. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- match generator: nested scan over sessions × events applying every filter dimension in one pass.
export async function* searchSessions(f: SearchFilters): AsyncGenerator<Match> {
  const ctx = buildCtx(f);
  const counter = { matches: 0 };

  for (const adapter of selectAdapters(f.agents, f.overrides)) {
    const metas = (await adapter.findSessions()).sort((a, b) => b.mtime - a.mtime);
    for (const meta of metas) {
      if (!matchArchived(meta, f.archived) || !matchProgrammatic(meta, f.programmatic)) continue;
      if (!matchModels(meta, f.models)) continue;
      if (!cwdMatches(meta.cwd, ctx.cwdNeedles)) continue;
      const session = await tryReadSession(adapter, meta.path);
      if (!session) continue;
      for (const e of session.events) {
        const hay = matchHay(e, ctx);
        if (hay === null) continue;
        yield {
          agent: session.agent,
          sessionId: session.id,
          path: session.path,
          ts: e.ts,
          kind: e.kind,
          tool: e.tool,
          cwd: session.cwd,
          archived: meta.archived,
          snippet: snippet(hay || (e.tool ?? ""), ctx.re, ctx.doMask),
        };
        if (f.limit && ++counter.matches >= f.limit) return;
      }
    }
  }
}

/** Collect all event-level matches into an array. */
export async function search(f: SearchFilters): Promise<Match[]> {
  return collect(searchSessions(f));
}

/** Session-level search: one entry per matching session, with a representative
 *  snippet and match count. `limit` bounds the number of sessions returned. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- session-level scorer: accumulates per-kind match metadata in a single pass over each session.
export async function searchSessionHits(f: SearchFilters): Promise<SessionHit[]> {
  const ctx = buildCtx(f);
  const out: SessionHit[] = [];

  for (const adapter of selectAdapters(f.agents, f.overrides)) {
    const metas = (await adapter.findSessions()).sort((a, b) => b.mtime - a.mtime);
    for (const meta of metas) {
      if (!matchArchived(meta, f.archived) || !matchProgrammatic(meta, f.programmatic)) continue;
      if (!matchModels(meta, f.models)) continue;
      if (!cwdMatches(meta.cwd, ctx.cwdNeedles)) continue;
      const session = await tryReadSession(adapter, meta.path);
      if (!session) continue;
      const hays = session.events.flatMap((e) => {
        const hay = matchHay(e, ctx);
        return hay === null ? [] : [hay || (e.tool ?? "")];
      });
      const firstHay = hays[0];
      if (firstHay === undefined) continue;
      const matchCount = hays.length;
      const firstSnippet = snippet(firstHay, ctx.re, ctx.doMask);
      out.push({
        agent: session.agent,
        sessionId: session.id,
        path: session.path,
        cwd: session.cwd,
        title: ctx.doMask ? mask(session.title, true) : session.title,
        ts: session.ended,
        mtime: session.mtime,
        models: meta.models,
        archived: meta.archived,
        imported: meta.imported,
        programmatic: meta.programmatic,
        origin: meta.origin,
        isSubagent: meta.isSubagent,
        parentId: meta.parentId,
        agentName: meta.agentName,
        matchCount,
        snippet: firstSnippet,
      });
      if (f.limit && out.length >= f.limit) return out;
    }
  }
  return out;
}
