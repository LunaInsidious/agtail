import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  apiFacets,
  apiSearch,
  apiSession,
  apiSessions,
  type Agent,
  type Event,
  type Filters,
  type Session,
  type SessionHit,
  type SessionMeta,
} from "./api.js";

// Search context carried from a hit into the opened session's in-view search.
type Seed = { find: string; tool?: string };

// Human-readable label for a programmatic session's launch origin (Claude's
// entrypoint or Codex's originator), so "what is this?" is answerable at a glance.
function originLabel(origin?: string): string {
  if (!origin) return "programmatic";
  const o = origin.toLowerCase();
  if (o.startsWith("sdk")) {
    if (o.includes("py")) return "Agent SDK (Python)";
    if (o.includes("ts") || o.includes("node") || o.includes("js")) return "Agent SDK (TypeScript)";
    if (o.includes("cli")) return "Agent SDK (CLI)";
    return "Agent SDK";
  }
  if (o === "claude-desktop") return "Desktop app";
  return origin; // e.g. a Codex originator name
}
const PROGRAMMATIC_TIP =
  "Programmatic session — launched by tooling (the Agent SDK, a hook, plugin, script, or the desktop app), not typed interactively by a person.";

const homeShort = (p: string) => p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");

// Recent text searches: a most-recently-used list persisted in localStorage and
// offered as suggestions on the search box. Recorded on blur/Enter (not per
// keystroke), so typing "hoge" never leaves "ho"/"hog" behind; distinct queries
// (incl. "ho" and "hoge") are kept as separate entries.
const RECENT_KEY = "agtail.recent";
const RECENT_CAP = 25;
function loadRecent(): string[] {
  const raw = localStorage.getItem(RECENT_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

// Cheap signature to detect that a cached session changed (a live one grew):
// event count + last-event time. Append-only logs make this reliable enough to
// avoid a needless re-render when the revalidated copy is identical.
const sessionSig = (s: Session) => `${s.events.length}:${s.ended ?? ""}`;

// Search result cap (matching events). User-selectable; 0 means no limit ("All").
// Hitting the cap means results were truncated and there may be more ("500+").
const DEFAULT_LIMIT = 500;
const LIMIT_OPTIONS: { value: number; label: string }[] = [
  { value: 100, label: "100" },
  { value: 500, label: "500" },
  { value: 1000, label: "1,000" },
  { value: 5000, label: "5,000" },
  { value: 0, label: "All" },
];

const AGENTS: Agent[] = ["claude-code", "codex"];
const tag = (a: Agent) => (a === "claude-code" ? "claude" : a);
const fmtTs = (ts?: string) => {
  if (!ts) return "";
  const d = new Date(ts);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const pretty = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

// Collapsible checkbox list for an array filter (tools / models / projects):
// click to toggle; selections also show as removable chips in the bar. The
// header shows the selected count and long lists (>8) start collapsed to keep
// the popover compact. Mounts with the popover, so options are already loaded.
function CheckList({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(() => options.length <= 8);
  if (!options.length) return null;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="frow">
      <button type="button" className="disc" onClick={() => setOpen((o) => !o)}>
        <span className="lbl">
          {label}
          {selected.length ? ` (${selected.length})` : ""}
        </span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="checklist">
          {options.map((o) => (
            <label key={o.value} className={selected.includes(o.value) ? "on" : ""}>
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const emptyFilters: Filters = {
  q: "",
  agents: [],
  tools: [],
  models: [],
  cwds: [],
  since: "",
  until: "",
  kinds: [],
  mask: false,
  archived: "all",
  programmatic: "all",
};

// Filter/search state lives in the browser's history entry (history.state), not
// the URL: back/forward and reload both restore it, while the address bar stays
// clean so no local paths or search text ever leak into a shareable/synced URL.
type HistorySnap = { filters: Filters; limit: number; open: { agent: Agent; id: string } | null };
function readHistory(): HistorySnap {
  const s = (window.history.state?.agtail ?? null) as Partial<HistorySnap> | null;
  return {
    // Merge onto emptyFilters so an older snapshot missing a newer field still
    // gets that field's default.
    filters: { ...emptyFilters, ...(s?.filters ?? {}) },
    limit: typeof s?.limit === "number" ? s.limit : DEFAULT_LIMIT,
    open: s?.open ?? null,
  };
}

export function App() {
  const [filters, setFilters] = useState<Filters>(() => readHistory().filters);
  const [facets, setFacets] = useState<{ tools: string[]; cwds: string[]; models: string[] }>({
    tools: [],
    cwds: [],
    models: [],
  });
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [hits, setHits] = useState<SessionHit[] | null>(null);
  const [cur, setCur] = useState<Session | null>(null);
  const [seed, setSeed] = useState<Seed>({ find: "" });
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0); // guards against stale (out-of-order) search resolutions
  const sessionsSeq = useRef(0); // same, for the session-list fetch
  const openSeq = useRef(0); // same, for opening a session
  // LRU cache of opened sessions (events + usage), keyed by agent:id:mask, so
  // re-opening one — notably via back/forward — is instant with no refetch.
  const sessionCache = useRef(new Map<string, Session>());
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState<number>(() => readHistory().limit);
  const set = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  // Recent search suggestions (text only). Recorded on blur/Enter.
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [recentOpen, setRecentOpen] = useState(false);
  const pushRecent = (q: string) => {
    const v = q.trim();
    if (!v) return;
    setRecent((r) => {
      const next = [v, ...r.filter((x) => x !== v)].slice(0, RECENT_CAP);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  };
  const clearRecent = () => {
    localStorage.removeItem(RECENT_KEY);
    setRecent([]);
    setRecentOpen(false);
  };
  const selectRecent = (v: string) => {
    set({ q: v }); // live-search effect re-runs for the picked query
    pushRecent(v);
    setRecentOpen(false);
  };

  // History (back/forward + reload) carries filters, limit AND the open session.
  // The effects live after `open` is defined (below). histRef holds the snapshot
  // already in history so a popstate/init never re-pushes it; skipFirstPush drops
  // the one push that would otherwise fire for the already-in-history mount state.
  const histRef = useRef("");
  const skipFirstPush = useRef(true);

  // Status filter mirrors the agent toggles: two chips (active / archived) where
  // neither-or-both selected means "all", matching the agents "none = all" idiom.
  const toggleStatus = (k: "active" | "archived") => {
    let active = filters.archived === "none";
    let archived = filters.archived === "only";
    if (k === "active") active = !active;
    else archived = !archived;
    set({ archived: active && !archived ? "none" : archived && !active ? "only" : "all" });
  };

  // Origin filter (interactive vs programmatic), same none/both = all idiom.
  const toggleOrigin = (k: "interactive" | "programmatic") => {
    let interactive = filters.programmatic === "none";
    let programmatic = filters.programmatic === "only";
    if (k === "interactive") interactive = !interactive;
    else programmatic = !programmatic;
    set({ programmatic: interactive && !programmatic ? "none" : programmatic && !interactive ? "only" : "all" });
  };

  // Close the filter popover on outside click. The ref wraps button + popover so
  // clicking the toggle itself doesn't immediately re-close it.
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showFilters) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setShowFilters(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showFilters]);

  // Applied filters render as always-visible removable chips; the controls to
  // add/edit them live in the popover. Unused dimensions take no bar space.
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  for (const a of filters.agents)
    chips.push({ key: "agent:" + a, label: tag(a), onRemove: () => set({ agents: filters.agents.filter((x) => x !== a) }) });
  for (const t of filters.tools)
    chips.push({ key: "tool:" + t, label: "⚙ " + t, onRemove: () => set({ tools: filters.tools.filter((x) => x !== t) }) });
  for (const m of filters.models)
    chips.push({ key: "model:" + m, label: "✦ " + m, onRemove: () => set({ models: filters.models.filter((x) => x !== m) }) });
  for (const c of filters.cwds)
    chips.push({ key: "cwd:" + c, label: "📁 " + homeShort(c), onRemove: () => set({ cwds: filters.cwds.filter((x) => x !== c) }) });
  if (filters.since) chips.push({ key: "since", label: "≥ " + filters.since, onRemove: () => set({ since: "" }) });
  if (filters.until) chips.push({ key: "until", label: "≤ " + filters.until, onRemove: () => set({ until: "" }) });
  if (filters.archived !== "all")
    chips.push({
      key: "status",
      label: filters.archived === "only" ? "🗄 archived" : "active only",
      onRemove: () => set({ archived: "all" }),
    });
  if (filters.programmatic !== "all")
    chips.push({
      key: "origin",
      label: filters.programmatic === "only" ? "🤖 programmatic" : "interactive only",
      onRemove: () => set({ programmatic: "all" }),
    });
  if (filters.mask) chips.push({ key: "mask", label: "🔒 mask", onRemove: () => set({ mask: false }) });

  const clearAll = () =>
    set({ agents: [], tools: [], models: [], cwds: [], since: "", until: "", archived: "all", programmatic: "all", mask: false });

  // Hits are matching sessions. With a finite cap, reaching it means more
  // sessions matched than were returned; "All" (limit 0) never truncates.
  const truncated = !!hits && limit > 0 && hits.length >= limit;

  // Resizable sidebar (persisted).
  const [sbWidth, setSbWidth] = useState(() => {
    const v = Number(localStorage.getItem("agtail.sbWidth"));
    return v >= 200 && v <= 900 ? v : 340;
  });
  useEffect(() => {
    localStorage.setItem("agtail.sbWidth", String(sbWidth));
  }, [sbWidth]);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => setSbWidth(Math.min(900, Math.max(200, ev.clientX)));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // A content search (query / tool / date / kind) produces snippets; attribute
  // filters (agent / model / project / status / origin) narrow without one.
  const hasSearch =
    filters.q.trim() !== "" ||
    filters.tools.length > 0 ||
    filters.since !== "" ||
    filters.until !== "" ||
    filters.kinds.length > 0;
  // ANY active filter shows the filtered "Results"; none → the browse "Sessions".
  const anyFilter =
    hasSearch ||
    filters.agents.length > 0 ||
    filters.models.length > 0 ||
    filters.cwds.length > 0 ||
    filters.archived !== "all" ||
    filters.programmatic !== "all";

  // Browse list: only meaningful with no filter active (results come from the
  // search path). So fetch the full list unfiltered and skip while filtering.
  useEffect(() => {
    if (anyFilter) return;
    const seq = ++sessionsSeq.current;
    apiSessions({}).then((s) => {
      if (sessionsSeq.current === seq) setSessions(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyFilter]);

  useEffect(() => {
    apiFacets().then(setFacets);
  }, []);

  // Stable identity so memoized SessionList/HitList/Timeline don't re-render on
  // every keystroke (open only depends on the mask setting).
  const open = useCallback(
    async (agent: Agent, id: string, withSeed?: Seed) => {
      setSeed(withSeed ?? { find: "" });
      const key = `${agent}:${id}:${filters.mask ? 1 : 0}`;
      const cache = sessionCache.current;
      const store = (s: Session) => {
        cache.delete(key); // re-insert so the key becomes most-recently-used
        cache.set(key, s);
        if (cache.size > 12) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
      };
      // Guard against out-of-order resolutions: a slow earlier open must not
      // clobber a newer one (e.g. the mount restore vs. a quick click).
      const seq = ++openSeq.current;
      const cached = cache.get(key);
      if (cached) {
        // Show the cached session instantly, then revalidate in the background:
        // a live session may have grown, so refetch and swap in only if changed.
        cache.delete(key);
        cache.set(key, cached);
        setLoading(false);
        setCur(cached);
        void apiSession(agent, id, filters.mask)
          .then((fresh) => {
            store(fresh);
            if (openSeq.current === seq && sessionSig(fresh) !== sessionSig(cached)) setCur(fresh);
          })
          .catch(() => {
            /* keep the cached view; a background revalidation failure is non-fatal */
          });
        return;
      }
      setLoading(true);
      try {
        const s = await apiSession(agent, id, filters.mask);
        if (openSeq.current !== seq) return;
        store(s);
        setCur(s);
      } finally {
        if (openSeq.current === seq) setLoading(false);
      }
    },
    [filters.mask],
  );

  // When a row becomes the open session, the row whose id matches this ref is
  // scrolled to the TOP of the list (vs the default "scroll just into view");
  // set on a parent jump so the parent lands at the top. One-shot.
  const scrollTargetRef = useRef<string | null>(null);

  // Opening a session's parent from the timeline header. If the parent is among
  // the current search results, stay in results and just open (its row gets the
  // active highlight). Otherwise clear the content search so the list drops back
  // to the full browse tree, where the parent lives in context. Either way the
  // parent row is scrolled to the top.
  const openParent = useCallback(
    (agent: Agent, id: string) => {
      const inResults = !!hits?.some((h) => h.sessionId === id);
      if (!inResults) setFilters((f) => ({ ...f, q: "", tools: [], since: "", until: "", kinds: [] }));
      scrollTargetRef.current = id;
      void open(agent, id);
    },
    [open, hits],
  );

  // Keep the latest `open` reachable from the once-registered popstate listener.
  const openRef = useRef(open);
  openRef.current = open;

  // Push the CURRENT render's state as a new back-able history entry, deduped
  // against the entry already in history. Defined per-render so it closes over
  // the live filters/limit/cur (no stale snapshot).
  const pushSnap = () => {
    const snap: HistorySnap = { filters, limit, open: cur ? { agent: cur.agent, id: cur.id } : null };
    const s = JSON.stringify(snap);
    if (s === histRef.current) return; // already the current entry
    histRef.current = s;
    window.history.pushState({ ...window.history.state, agtail: snap }, "");
  };
  // Signatures that should create an entry the instant they change (discrete
  // navigation), vs the query text which is debounced while typing.
  const openSig = cur ? `${cur.agent}:${cur.id}` : "";
  const chipSig = JSON.stringify([
    filters.agents, filters.tools, filters.models, filters.cwds, filters.since,
    filters.until, filters.kinds, filters.mask, filters.archived, filters.programmatic, limit,
  ]);

  // On mount, restore the open session recorded in history (filters/limit were
  // already seeded into useState). histRef is set to the restored snapshot so the
  // restore's own state change doesn't get re-pushed as a new entry.
  useEffect(() => {
    const snap = readHistory();
    histRef.current = JSON.stringify(snap);
    if (snap.open) void open(snap.open.agent, snap.open.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open a session, change a chip, or change the cap → its own entry immediately,
  // so browsing sessions is fully back/forward-able however fast you click. The
  // first run is the already-in-history mount state, so it's skipped.
  useEffect(() => {
    if (skipFirstPush.current) {
      skipFirstPush.current = false;
      return;
    }
    pushSnap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSig, chipSig]);

  // Typing in the query box settles into a single entry — debounced.
  useEffect(() => {
    const t = setTimeout(pushSnap, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q]);

  // Back/forward: restore the snapshot — filters, limit, and the open session.
  useEffect(() => {
    const onPop = () => {
      const snap = readHistory();
      histRef.current = JSON.stringify(snap);
      setFilters(snap.filters);
      setLimit(snap.limit);
      if (snap.open) void openRef.current(snap.open.agent, snap.open.id);
      else setCur(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Live search: re-run as filters change (debounced so typing isn't a request
  // per keystroke). Does NOT toggle the main `loading` — searching must not blank
  // the open session's timeline.
  useEffect(() => {
    if (!anyFilter) {
      searchSeq.current++; // invalidate any in-flight search
      setHits(null);
      setSearching(false);
      return;
    }
    setSearching(true); // stays true through debounce AND fetch (guarded below)
    const seq = ++searchSeq.current;
    const t = setTimeout(() => {
      apiSearch(filters, limit)
        // Ignore a stale resolution so an older search can't clear the loading
        // state (or overwrite results) while a newer one is still pending.
        .then((h) => { if (searchSeq.current === seq) setHits(h); })
        .finally(() => { if (searchSeq.current === seq) setSearching(false); });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    anyFilter,
    filters.q,
    filters.agents.join(","),
    filters.tools.join(","),
    filters.models.join(","),
    filters.cwds.join(","),
    filters.since,
    filters.until,
    filters.kinds.join(","),
    filters.mask,
    filters.archived,
    filters.programmatic,
    limit,
  ]);

  // Enter / Search button: run immediately (skip the debounce).
  function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    pushRecent(filters.q);
    setRecentOpen(false);
    if (!anyFilter) return;
    setSearching(true);
    const seq = ++searchSeq.current;
    apiSearch(filters, limit)
      .then((h) => { if (searchSeq.current === seq) setHits(h); })
      .finally(() => { if (searchSeq.current === seq) setSearching(false); });
  }

  // Recent searches matching the current text (substring), newest first.
  const needleLc = filters.q.trim().toLowerCase();
  const recentMatches = recent.filter((r) => r !== filters.q && r.toLowerCase().includes(needleLc));

  return (
    <div className="app">
      <header>
        <span className="brand">
          <b>≋</b> agtail
        </span>
        <form className="search" onSubmit={runSearch}>
          <div className="searchbox">
            <input
              type="search"
              placeholder="Search across all sessions…"
              value={filters.q}
              onChange={(e) => {
                set({ q: e.target.value });
                setRecentOpen(true);
              }}
              onFocus={() => setRecentOpen(true)}
              onBlur={() => {
                pushRecent(filters.q);
                setRecentOpen(false);
              }}
            />
            {recentOpen && recentMatches.length > 0 && (
              <div className="recent">
                {recentMatches.map((r) => (
                  // mousedown (not click) + preventDefault so the input doesn't
                  // blur-and-close before the selection registers.
                  <button
                    type="button"
                    key={r}
                    className="recentitem"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectRecent(r);
                    }}
                  >
                    <span className="ric">🕘</span>
                    {r}
                  </button>
                ))}
                <button
                  type="button"
                  className="recentclear"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    clearRecent();
                  }}
                >
                  Clear history
                </button>
              </div>
            )}
          </div>
          <button type="submit">Search</button>
        </form>
        <div className="filtermenu" ref={popRef}>
          <button
            type="button"
            className={"addfilter" + (chips.length ? " has" : "")}
            onClick={() => setShowFilters((v) => !v)}
          >
            ⊕ Filters{chips.length ? ` (${chips.length})` : ""}
          </button>
          {showFilters && (
            <div className="filterpop">
              <CheckList
                label="tool"
                options={[
                  ...(facets.tools.some((t) => t.startsWith("mcp__")) ? [{ value: "mcp__*", label: "mcp__* (all MCP)" }] : []),
                  ...facets.tools.map((t) => ({ value: t, label: t })),
                ]}
                selected={filters.tools}
                onChange={(tools) => set({ tools })}
              />
              <CheckList
                label="model"
                options={facets.models.map((m) => ({ value: m, label: m }))}
                selected={filters.models}
                onChange={(models) => set({ models })}
              />
              <CheckList
                label="project (cwd)"
                options={facets.cwds.map((c) => ({ value: c, label: homeShort(c) }))}
                selected={filters.cwds}
                onChange={(cwds) => set({ cwds })}
              />
              <div className="frow">
                <span className="lbl">date range</span>
                <div className="dates">
                  <input type="date" value={filters.since} onChange={(e) => set({ since: e.target.value })} title="since" />
                  <input type="date" value={filters.until} onChange={(e) => set({ until: e.target.value })} title="until" />
                </div>
              </div>
              <div className="frow">
                <span className="lbl">agent</span>
                <span className="agents">
                  {AGENTS.map((a) => (
                    <label key={a} className={filters.agents.includes(a) ? "on" : ""}>
                      <input
                        type="checkbox"
                        checked={filters.agents.includes(a)}
                        onChange={(e) =>
                          set({
                            agents: e.target.checked
                              ? [...filters.agents, a]
                              : filters.agents.filter((x) => x !== a),
                          })
                        }
                      />
                      {tag(a)}
                    </label>
                  ))}
                </span>
              </div>
              <div className="frow">
                <span className="lbl">status</span>
                <span className="agents">
                  <label className={filters.archived === "none" ? "on" : ""}>
                    <input type="checkbox" checked={filters.archived === "none"} onChange={() => toggleStatus("active")} />
                    active
                  </label>
                  <label className={filters.archived === "only" ? "on" : ""}>
                    <input type="checkbox" checked={filters.archived === "only"} onChange={() => toggleStatus("archived")} />
                    🗄 archived
                  </label>
                </span>
              </div>
              <div className="frow">
                <span className="lbl">origin</span>
                <span className="agents">
                  <label className={filters.programmatic === "none" ? "on" : ""}>
                    <input type="checkbox" checked={filters.programmatic === "none"} onChange={() => toggleOrigin("interactive")} />
                    interactive
                  </label>
                  <label className={filters.programmatic === "only" ? "on" : ""}>
                    <input type="checkbox" checked={filters.programmatic === "only"} onChange={() => toggleOrigin("programmatic")} />
                    🤖 programmatic
                  </label>
                </span>
              </div>
              <div className="frow">
                <span className="lbl">output</span>
                <label className="mask">
                  <input type="checkbox" checked={filters.mask} onChange={(e) => set({ mask: e.target.checked })} />
                  Mask secrets
                </label>
              </div>
              <div className="frow">
                <span className="lbl">max results</span>
                <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                  {LIMIT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {chips.length > 0 && (
                <button type="button" className="clear" onClick={clearAll}>
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>
        {chips.length > 0 && (
          <div className="chips">
            {chips.map((c) => (
              <span className="fchip" key={c.key}>
                {c.label}
                <button type="button" className="x" onClick={c.onRemove} title="remove filter">
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </header>

      <main>
        <aside className="sidebar" style={{ flex: `0 0 ${sbWidth}px`, width: sbWidth }}>
          {/* One list, two modes: browse (no search) shows every session as a
              tree; searching shows only matched sessions (matched child nested
              under matched parent, else standalone). */}
          <div className="listhead">
            {anyFilter ? (
              <>Results {hits ? `(${hits.length}${truncated ? "+" : ""})` : ""}</>
            ) : (
              <>Sessions {sessions.length ? `(${sessions.length})` : ""}</>
            )}
            {searching && <span className="spinner" />}
          </div>
          {anyFilter ? (
            <HitList
              hits={hits ?? []}
              truncated={truncated}
              searching={searching}
              showMatch={hasSearch}
              seed={{ find: filters.q, tool: filters.tools[0] }}
              cur={cur}
              onOpen={open}
              scrollTarget={scrollTargetRef}
            />
          ) : (
            <SessionList sessions={sessions} cur={cur} onOpen={open} scrollTarget={scrollTargetRef} />
          )}
        </aside>
        <div className="resizer" onMouseDown={startResize} title="Drag to resize" />
        <section className="timeline">
          {loading && <div className="empty">Loading…</div>}
          {!loading && !cur && (
            <div className="empty">
              ← Select a session from the list
              <br />
              or search across all sessions from the bar above ↑
            </div>
          )}
          {!loading && cur && <Timeline session={cur} seed={seed} onOpen={open} onOpenParent={openParent} />}
        </section>
      </main>
    </div>
  );
}

function SessionRow({
  s,
  cur,
  onOpen,
  scrollTarget,
  child,
}: {
  s: SessionMeta;
  cur: Session | null;
  onOpen: (a: Agent, id: string) => void;
  scrollTarget: React.MutableRefObject<string | null>;
  child?: boolean;
}) {
  const active = !!cur && cur.id === s.id;
  const ref = useRef<HTMLDivElement>(null);
  // Bring the selected row into view. Default "nearest" is a no-op if already
  // visible; a parent jump (scrollTarget matches) lands the row at the top.
  useEffect(() => {
    if (!active) return;
    const top = scrollTarget.current === s.id;
    if (top) scrollTarget.current = null;
    ref.current?.scrollIntoView({ block: top ? "start" : "nearest" });
  }, [active]);
  return (
    <div
      ref={ref}
      className={"sess" + (child ? " child" : "") + (s.archived || s.programmatic ? " dim" : "") + (active ? " active" : "")}
      onClick={() => onOpen(s.agent, s.id)}
    >
      <div className="row1">
        {child && <span className="branch">↳</span>}
        <span className={"src " + s.agent}>{tag(s.agent)}</span>
        {s.archived && <span className="archmark" title="archived">🗄</span>}
        {s.programmatic && (
          <span className="automark" title={PROGRAMMATIC_TIP}>
            🤖 {originLabel(s.origin)}
          </span>
        )}
        {s.isSubagent && s.agentName && <span className="agentname">{s.agentName}</span>}
        <span className="sid">{s.id.slice(0, 8)}</span>
        <span>{fmtTs(s.ended)}</span>
        <span>{s.messages}ev</span>
        {!child && <span className="cwd">{(s.cwd ?? "?").replace(/^.*\/(?=[^/]+\/[^/]+$)/, "…/")}</span>}
      </div>
      <div className="title">{s.title}</div>
    </div>
  );
}

const SessionList = memo(function SessionList({
  sessions,
  cur,
  onOpen,
  scrollTarget,
}: {
  sessions: SessionMeta[];
  cur: Session | null;
  onOpen: (a: Agent, id: string) => void;
  scrollTarget: React.MutableRefObject<string | null>;
}) {
  if (!sessions.length) return <div className="empty">None</div>;
  // Nest subagent sessions under the parent that spawned them.
  const childrenOf = new Map<string, SessionMeta[]>();
  for (const s of sessions) {
    if (s.isSubagent && s.parentId) {
      const arr = childrenOf.get(s.parentId) ?? [];
      arr.push(s);
      childrenOf.set(s.parentId, arr);
    }
  }
  const present = new Set(sessions.map((s) => s.id));
  const props = { cur, onOpen, scrollTarget };
  return (
    <>
      {sessions.map((s) => {
        if (s.isSubagent) {
          // Rendered as a child under its parent below; skip here when present.
          if (s.parentId && present.has(s.parentId)) return null;
          // Orphan (parent filtered out): show as a standalone top-level row, NOT
          // with the child indent — otherwise it looks nested under the unrelated
          // row above it (e.g. a Claude subagent appearing under a Codex session).
          return <SessionRow key={s.path} s={s} {...props} />;
        }
        const kids = childrenOf.get(s.id) ?? [];
        return (
          // Key on the file path: unique per session file even if two rollouts
          // ever resolve to the same id, so React never strands stale rows.
          <div key={s.path}>
            <SessionRow s={s} {...props} />
            {kids.map((c) => (
              <SessionRow key={c.path} s={c} child {...props} />
            ))}
          </div>
        );
      })}
    </>
  );
});

function HitRow({
  m,
  cur,
  seed,
  onOpen,
  scrollTarget,
  showMatch,
  child,
}: {
  m: SessionHit;
  cur: Session | null;
  seed: Seed;
  onOpen: (a: Agent, id: string, seed?: Seed) => void;
  scrollTarget: React.MutableRefObject<string | null>;
  showMatch: boolean;
  child?: boolean;
}) {
  const active = !!cur && cur.id === m.sessionId;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const top = scrollTarget.current === m.sessionId;
    if (top) scrollTarget.current = null;
    ref.current?.scrollIntoView({ block: top ? "start" : "nearest" });
  }, [active]);
  return (
    <div
      ref={ref}
      className={"hit" + (child ? " child" : "") + (m.archived || m.programmatic ? " dim" : "") + (active ? " active" : "")}
      onClick={() => onOpen(m.agent, m.sessionId, seed)}
    >
      <div className="row1">
        {child && <span className="branch">↳</span>}
        <span className={"src " + m.agent}>{tag(m.agent)}</span>
        {m.archived && <span className="archmark" title="archived">🗄</span>}
        {m.programmatic && (
          <span className="automark" title={PROGRAMMATIC_TIP}>
            🤖 {originLabel(m.origin)}
          </span>
        )}
        {m.isSubagent && m.agentName && <span className="agentname">{m.agentName}</span>}
        <span className="sid">{m.sessionId.slice(0, 8)}</span>
        <span>{fmtTs(m.ts)}</span>
        {showMatch && (
          <span className="matchn" title="matching events">
            {m.matchCount} match{m.matchCount === 1 ? "" : "es"}
          </span>
        )}
      </div>
      <div className="title">{m.title}</div>
      {showMatch && <div className="snippet">{m.snippet}</div>}
    </div>
  );
}

const HitList = memo(function HitList({
  hits,
  truncated,
  searching,
  showMatch,
  seed,
  cur,
  onOpen,
  scrollTarget,
}: {
  hits: SessionHit[];
  truncated: boolean;
  searching: boolean;
  showMatch: boolean;
  seed: Seed;
  cur: Session | null;
  onOpen: (a: Agent, id: string, seed?: Seed) => void;
  scrollTarget: React.MutableRefObject<string | null>;
}) {
  // No results yet (first search) → centered spinner. Re-search with existing
  // results keeps them visible and shows a thin loading strip on top.
  if (!hits.length) {
    return searching ? (
      <div className="empty"><span className="spinner" /> Searching…</div>
    ) : (
      <div className="empty">No matches</div>
    );
  }
  // Nest a matched subagent under its matched parent; a matched subagent whose
  // parent isn't among the results shows standalone (flat). Same rule as the
  // browse list — only nodes that actually matched appear.
  const childrenOf = new Map<string, SessionHit[]>();
  for (const m of hits)
    if (m.isSubagent && m.parentId) {
      const arr = childrenOf.get(m.parentId) ?? [];
      arr.push(m);
      childrenOf.set(m.parentId, arr);
    }
  const present = new Set(hits.map((m) => m.sessionId));
  const rowProps = { cur, seed, onOpen, scrollTarget, showMatch };
  return (
    <>
      {searching && <div className="searchbar" />}
      {truncated && (
        <div className="trunc">
          Showing the first {hits.length} sessions — raise “max results” or refine your search to see more.
        </div>
      )}
      {hits.map((m) => {
        if (m.isSubagent) {
          if (m.parentId && present.has(m.parentId)) return null; // nested below
          return <HitRow key={m.path} m={m} {...rowProps} />; // orphan match → flat
        }
        const kids = childrenOf.get(m.sessionId) ?? [];
        return (
          <div key={m.path}>
            <HitRow m={m} {...rowProps} />
            {kids.map((c) => (
              <HitRow key={c.path} m={c} child {...rowProps} />
            ))}
          </div>
        );
      })}
    </>
  );
});

// Searchable text for one event (in-session find).
function eventText(e: Event): string {
  const parts = [e.text ?? "", e.tool ?? "", summarizeInput(e.tool, e.input), e.result?.text ?? ""];
  if (e.raw)
    try {
      parts.push(JSON.stringify(e.raw));
    } catch {
      /* ignore */
    }
  return parts.join(" ");
}

// Split text and wrap occurrences of `term` in <mark>.
function Highlighted({ text, term }: { text: string; term?: string }) {
  if (!term) return <>{text}</>;
  const lc = text.toLowerCase();
  const t = term.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  for (let j = lc.indexOf(t, i); j !== -1; j = lc.indexOf(t, i)) {
    if (j > i) out.push(text.slice(i, j));
    out.push(<mark key={j}>{text.slice(j, j + term.length)}</mark>);
    i = j + term.length;
  }
  out.push(text.slice(i));
  return <>{out}</>;
}

// A glob tool filter (e.g. "mcp__*") can't seed the exact-match in-session filter.
const seedTools = (s: Seed) => (s.tool && !s.tool.includes("*") ? new Set([s.tool]) : new Set<string>());

const Timeline = memo(function Timeline({
  session,
  seed,
  onOpen,
  onOpenParent,
}: {
  session: Session;
  seed: Seed;
  onOpen: (a: Agent, id: string, seed?: Seed) => void;
  onOpenParent: (a: Agent, id: string) => void;
}) {
  const [toolFilter, setToolFilter] = useState<Set<string>>(() => seedTools(seed));
  const [showThinking, setShowThinking] = useState(true);
  const [showMeta, setShowMeta] = useState(false);
  const [showHooks, setShowHooks] = useState(true); // master toggle for all hooks
  const [hookFocus, setHookFocus] = useState<Set<string>>(new Set()); // focus hook types (empty = all), like tools
  const [find, setFind] = useState(seed.find);
  // The applied query is debounced so a per-keystroke re-render of a huge
  // timeline doesn't make typing lag (the input itself stays immediate).
  const [needle, setNeedle] = useState(seed.find.trim().toLowerCase());
  // Text find is non-destructive by default (highlight + jump); "matches only"
  // collapses the timeline to just the matching events.
  const [matchesOnly, setMatchesOnly] = useState(false);
  const [activeMatch, setActiveMatch] = useState(0);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  // Tools live behind a disclosure (a session can have 20+ tools incl. mcp__*),
  // so the controls row stays short regardless of count.
  const [showTools, setShowTools] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  // Re-apply the search context carried from a hit whenever a new session opens.
  useEffect(() => {
    setFind(seed.find);
    setNeedle(seed.find.trim().toLowerCase());
    setToolFilter(seedTools(seed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Debounce the applied query.
  useEffect(() => {
    const t = setTimeout(() => setNeedle(find.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [find]);

  // Close the tools popover on outside click.
  useEffect(() => {
    if (!showTools) return;
    const onDown = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setShowTools(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showTools]);

  const tools = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of session.events) if (e.kind === "tool_use" && e.tool) c.set(e.tool, (c.get(e.tool) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [session]);

  const toggle = (t: string) =>
    setToolFilter((s) => {
      const n = new Set(s);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

  const u = session.usage;
  // Precompute each event's searchable text once per session so matching on every
  // keystroke is a cheap `includes`, not a fresh eventText()/JSON.stringify pass.
  const searchText = useMemo(() => session.events.map((e) => eventText(e).toLowerCase()), [session]);

  // Events left after the explicit subsetting filters (thinking/meta/tool). The
  // text find does NOT subset here — it highlights + navigates over this set.
  const thinkingCount = useMemo(() => session.events.filter((e) => e.kind === "thinking").length, [session]);
  // Distinct hook lifecycle types present, for per-type show/hide (like tools).
  const hookTypes = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of session.events) if (e.kind === "hook") c.set(e.hookEvent ?? "hook", (c.get(e.hookEvent ?? "hook") ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [session]);
  const toggleHook = (t: string) =>
    setHookFocus((s) => {
      const n = new Set(s);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

  const matchesAt = (i: number) => !!needle && searchText[i]!.includes(needle);
  const isHidden = (e: Event, i: number) => {
    if (e.kind === "thinking" && !showThinking) return true;
    if (e.kind === "hook" && !showHooks) return true;
    if ((e.kind === "system" || e.kind === "unknown" || e.kind === "summary") && !showMeta) return true;
    // Tool and hook focus chips narrow the whole timeline to the selected kinds
    // (union when both are active), so picking a hook type shows only those hooks.
    if (toolFilter.size || hookFocus.size) {
      const focusTool = e.kind === "tool_use" && e.tool && toolFilter.has(e.tool);
      const focusHook = e.kind === "hook" && hookFocus.has(e.hookEvent ?? "hook");
      if (!focusTool && !focusHook) return true;
    }
    if (needle && matchesOnly && !matchesAt(i)) return true;
    return false;
  };
  // Original indices of the rows that pass the filters; the virtualized list only
  // mounts the ones on screen, so filtering/find/open are all O(viewport).
  const visibleIdx = useMemo(
    () => session.events.flatMap((e, i) => (isHidden(e, i) ? [] : [i])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, showThinking, showMeta, showHooks, hookFocus, toolFilter, needle, matchesOnly, searchText],
  );
  // Positions within `visibleIdx` that match the needle (jump counter/nav).
  const matchPositions = useMemo(
    () => (needle ? visibleIdx.flatMap((oi, p) => (matchesAt(oi) ? [p] : [])) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleIdx, needle, searchText],
  );
  const cur = matchPositions.length ? Math.min(activeMatch, matchPositions.length - 1) : 0;
  const activePos = needle && matchPositions.length ? matchPositions[cur]! : -1;
  const goMatch = (delta: number) =>
    matchPositions.length && setActiveMatch((a) => (a + delta + matchPositions.length) % matchPositions.length);

  // Reset to the first match when the query or the visible set changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(
    () => setActiveMatch(0),
    [needle, matchesOnly, showThinking, showMeta, showHooks, hookFocus, toolFilter, session.id],
  );
  // Scroll the active match into view as it changes.
  useEffect(() => {
    if (activePos >= 0) virtuosoRef.current?.scrollToIndex({ index: activePos, align: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, needle, matchesOnly]);

  return (
    <>
      <div className="thead">
      <div className="meta">
        <span className={"src " + session.agent}>{tag(session.agent)}</span>
        {session.archived && <span className="archmark" title="archived">🗄 archived</span>}
        {session.programmatic && (
          <span className="automark" title={PROGRAMMATIC_TIP}>
            🤖 {originLabel(session.origin)}
          </span>
        )}
        {session.isSubagent && (
          <span className="subof">
            ↳ subagent{session.agentName ? ` (${session.agentName})` : ""} of{" "}
            <a onClick={() => session.parentId && onOpenParent(session.agent, session.parentId)}>
              {session.parentId?.slice(0, 8)}
            </a>
          </span>
        )}
        <code>{session.id.slice(0, 8)}</code>
        <span>{session.cwd}</span>
        <span>{session.gitBranch ?? "-"}</span>
        <span title={session.models && session.models.length > 1 ? "models switched mid-session" : undefined}>
          {session.models?.length ? session.models.join(" → ") : (session.model ?? "")}
        </span>
        {u && (
          <span className="cost">
            {u.totalTokens.toLocaleString()} tok ·{" "}
            {u.costUsd != null ? `≈ $${u.costUsd.toFixed(4)}` : `cost unknown${u.unpricedModels.length ? ` (${u.unpricedModels.join(",")})` : ""}`}
          </span>
        )}
      </div>
      <div className="controls">
        <input
          type="search"
          className="insearch"
          placeholder="Search within this session"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              goMatch(e.shiftKey ? -1 : 1);
            }
          }}
        />
        {needle && (
          <span className="findnav">
            <button type="button" onClick={() => goMatch(-1)} disabled={!matchPositions.length} title="previous (Shift+Enter)">
              ↑
            </button>
            <button type="button" onClick={() => goMatch(1)} disabled={!matchPositions.length} title="next (Enter)">
              ↓
            </button>
            <span className="count">{matchPositions.length ? `${cur + 1}/${matchPositions.length}` : "0/0"}</span>
            <label className={matchesOnly ? "on" : ""}>
              <input type="checkbox" checked={matchesOnly} onChange={(e) => setMatchesOnly(e.target.checked)} /> matches only
            </label>
          </span>
        )}
        {thinkingCount > 0 && (
          <label className={showThinking ? "on" : ""}>
            <input type="checkbox" checked={showThinking} onChange={(e) => setShowThinking(e.target.checked)} /> thinking{" "}
            <em>{thinkingCount}</em>
          </label>
        )}
        <label className={showMeta ? "on" : ""}>
          <input type="checkbox" checked={showMeta} onChange={(e) => setShowMeta(e.target.checked)} /> system/meta
        </label>
        {hookTypes.length > 0 && (
          <span className="hookgroup">
            <label className={"hooklabel" + (showHooks ? " on" : "")} title="show/hide all hooks">
              <input type="checkbox" checked={showHooks} onChange={(e) => setShowHooks(e.target.checked)} /> 🪝 hooks
            </label>
            {showHooks && hookTypes.length > 0 && <span className="hooksep" />}
            {showHooks &&
              hookTypes.map(([t, n]) => (
                <button
                  key={"hook:" + t}
                  className={"chip" + (hookFocus.has(t) ? " on" : "")}
                  onClick={() => toggleHook(t)}
                  title="show only this hook type"
                >
                  {t} <em>{n}</em>
                </button>
              ))}
          </span>
        )}
        {tools.length > 0 && (
          <div className="toolmenu" ref={toolsRef}>
            <button className="chip" onClick={() => setShowTools((v) => !v)} title="filter to specific tools">
              🔧 tools <span className="caret">▾</span>
            </button>
            {/* Selected tools shown inline so the active filter is visible without opening. */}
            {tools
              .filter(([t]) => toolFilter.has(t))
              .map(([t, n]) => (
                <button key={t} className="chip on" onClick={() => toggle(t)} title="click to remove">
                  {t} <em>{n}</em> ✕
                </button>
              ))}
            {showTools && (
              <div className="toolpop">
                {tools.map(([t, n]) => (
                  <button key={t} className={"chip" + (toolFilter.has(t) ? " on" : "")} onClick={() => toggle(t)}>
                    {t} <em>{n}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      </div>
      <Virtuoso
        ref={virtuosoRef}
        className="events"
        style={{ flex: "1 1 auto", minHeight: 0 }}
        data={visibleIdx}
        increaseViewportBy={400}
        computeItemKey={(_, oi) => oi}
        itemContent={(index, oi) => (
          <div className={"evrow" + (index === activePos ? " active" : "")}>
            {/* Highlight only matching rows so non-matching rows skip re-render. */}
            <EventRow e={session.events[oi]!} highlight={matchesAt(oi) ? needle : undefined} />
          </div>
        )}
      />
    </>
  );
});

const COLLAPSE_LEN = 600;

// Per-turn token/cost for an assistant message (or the turn that emitted a tool).
function UsageBadge({ e }: { e: Event }) {
  if (e.tokens == null) return null;
  return (
    <span className="usage" title={e.model ?? ""}>
      {e.tokens.toLocaleString()} tok{e.cost != null ? ` · $${e.cost.toFixed(4)}` : " · cost unknown"}
    </span>
  );
}

const EventRow = memo(function EventRow({ e, highlight }: { e: Event; highlight?: string }) {
  if (e.kind === "tool_use") {
    return (
      <div className="ev tool">
        <div className="sig">⚙</div>
        <div className="body">
          <UsageBadge e={e} />
          <ToolHead e={e} highlight={highlight} />
        </div>
      </div>
    );
  }
  if (e.kind === "text") {
    // In a sidechain, role "user" is the parent agent's instruction, not the human.
    const human = e.role === "user" && !e.sidechain;
    const parentAgent = e.role === "user" && e.sidechain;
    const cls = human ? "user" : parentAgent ? "agentinstr" : "assistant";
    const label = parentAgent ? "agent" : e.role;
    return (
      <div className={"ev " + cls}>
        <div className="sig">{human ? "▸" : parentAgent ? "↳" : "◂"}</div>
        <div className="body">
          <UsageBadge e={e} />
          <span className="role">{label}</span>
          <Collapsible text={e.text ?? ""} markdown highlight={highlight} />
        </div>
      </div>
    );
  }
  if (e.kind === "thinking") {
    return (
      <div className="ev think">
        <div className="sig">∴</div>
        <div className="body">
          <Collapsible text={e.text ?? ""} collapsed highlight={highlight} />
        </div>
      </div>
    );
  }
  if (e.kind === "hook") return <HookRow e={e} highlight={highlight} />;
  if (e.kind === "unknown") {
    // Don't force-collapse: short raw shows inline, "Show all" only when long.
    return (
      <div className="ev unknown">
        <div className="sig">?</div>
        <div className="body">
          <span className="role">unknown · {e.text}</span>
          <Collapsible text={pretty(e.raw)} highlight={highlight} />
        </div>
      </div>
    );
  }
  const sig = e.kind === "summary" ? "—" : "○";
  return (
    <div className={"ev " + e.kind}>
      <div className="sig">{sig}</div>
      <div className="body">
        <Collapsible text={e.text ?? ""} highlight={highlight} />
      </div>
    </div>
  );
});

function ToolHead({ e, highlight }: { e: Event; highlight?: string }) {
  const summary = summarizeInput(e.tool, e.input);
  // When the in-session search matches input/result, default the detail open —
  // but leave it user-toggleable (don't force it).
  const inputStr = pretty(e.input);
  const resultStr = e.result?.text ?? "";
  const matchesDetail =
    !!highlight &&
    (inputStr.toLowerCase().includes(highlight.toLowerCase()) ||
      resultStr.toLowerCase().includes(highlight.toLowerCase()));
  const [open, setOpen] = useState(matchesDetail);
  useEffect(() => setOpen(matchesDetail), [matchesDetail]);
  return (
    <>
      <div className={"toolhead" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        {e.result && <span className={"rc " + (e.result.isError ? "err" : "ok")}>{e.result.isError ? "✗" : "✓"}</span>}
        <span className="name">
          <Highlighted text={e.tool ?? ""} term={highlight} />
        </span>
        <span className="sum">
          <Highlighted text={summary} term={highlight} />
        </span>
      </div>
      {open && (
        <div className="detail">
          <div className="seg">
            <div className="lbl">input</div>
            <pre>
              <Highlighted text={inputStr} term={highlight} />
            </pre>
          </div>
          {e.result && (
            <div className="seg">
              <div className="lbl">result{e.result.isError ? " · error" : ""}</div>
              <pre className={e.result.isError ? "err" : ""}>
                <Highlighted text={resultStr} term={highlight} />
              </pre>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Hook firing: a collapsed command-only line by default; click to reveal the
// full raw record. Mirrors the tool row's expand pattern (caret + detail).
function HookRow({ e, highlight }: { e: Event; highlight?: string }) {
  const rawStr = pretty(e.raw);
  const matchesDetail = !!highlight && rawStr.toLowerCase().includes(highlight.toLowerCase());
  const [open, setOpen] = useState(matchesDetail);
  useEffect(() => setOpen(matchesDetail), [matchesDetail]);
  return (
    <div className="ev hook">
      <div className="sig">🪝</div>
      <div className="body">
        <div className={"toolhead" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)}>
          <span className="caret">{open ? "▾" : "▸"}</span>
          <span className="role">hook</span>
          <span className="sum">
            <Highlighted text={e.text ?? ""} term={highlight} />
          </span>
        </div>
        {open && (
          <div className="detail">
            <div className="seg">
              <pre>
                <Highlighted text={rawStr} term={highlight} />
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Collapsible({
  text,
  markdown,
  collapsed,
  highlight,
}: {
  text: string;
  markdown?: boolean;
  collapsed?: boolean;
  highlight?: string;
}) {
  const heavy = collapsed || text.length > COLLAPSE_LEN;
  // Highlight match defaults the block open (but stays user-toggleable).
  const matches = !!highlight && text.toLowerCase().includes(highlight.toLowerCase());
  const [open, setOpen] = useState(!heavy || matches);
  useEffect(() => setOpen(!heavy || matches), [matches]);
  if (!text) return null;

  const moreBtn = heavy && (
    <button className="more" onClick={() => setOpen((o) => !o)}>
      {open ? "▲ Collapse" : `▼ Show all (${text.length.toLocaleString()} chars)`}
    </button>
  );

  // Prose: always render Markdown (clamp height when collapsed) so formatting
  // is consistent. While searching, fall back to plain text + <mark> so matches
  // stay visible.
  if (markdown && !highlight) {
    return (
      <div className="prose">
        <div className={"md" + (open ? "" : " clamp")}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
        {moreBtn}
      </div>
    );
  }

  // Raw text / code / JSON, or search mode: char-slice + optional highlight.
  const shown = open ? text : text.slice(0, COLLAPSE_LEN);
  return (
    <div className={"prose" + (open ? "" : " clipped")}>
      <span className="raw">
        <Highlighted text={shown} term={highlight} />
      </span>
      {moreBtn}
    </div>
  );
}

// Mirror of core/format.ts summarizeInput for the browser.
function summarizeInput(tool: string | undefined, input: unknown): string {
  if (input == null || typeof input !== "object") return String(input ?? "");
  const i = input as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  switch (tool) {
    case "Bash": {
      const cmd = s(i.command).replace(/\n/g, " ");
      return i.description ? `${cmd}   « ${s(i.description)}` : cmd;
    }
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
    case "Read":
      return s(i.file_path) || s(i.notebook_path);
    case "WebFetch":
      return s(i.url);
    case "WebSearch":
      return s(i.query);
    case "exec":
      return s(i.command);
    default:
      try {
        return JSON.stringify(i).slice(0, 300);
      } catch {
        return "";
      }
  }
}
