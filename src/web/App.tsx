import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiFacets,
  apiSearch,
  apiSession,
  apiSessions,
  type Agent,
  type Filters,
  type Session,
  type SessionHit,
  type SessionMeta,
} from "./lib/api.js";
import { defaultSavedName, filterChips, homeShort, savedChips, tag, uniqueName } from "./lib/filters.js";
import { sessionSig, type Seed } from "./lib/util.js";
import {
  AGENTS,
  emptyFilters,
  LIMIT_OPTIONS,
  loadRecent,
  loadSaved,
  readHistory,
  RECENT_CAP,
  RECENT_KEY,
  RECENT_SHOWN,
  SAVED_KEY,
  type HistorySnap,
  type SavedSearch,
} from "./lib/state.js";
import { CheckList } from "./components/CheckList.js";
import { ManageSaved } from "./components/ManageSaved.js";
import { HitList, SessionList } from "./components/SessionList.js";
import { Timeline } from "./components/Timeline.js";


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
  const [showSaved, setShowSaved] = useState(false);
  // The "Saved searches" manage screen lives at the /saved URL (so Back closes it).
  const [manageSaved, setManageSaved] = useState(() => window.location.pathname === "/saved");
  const savedRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState<number>(() => readHistory().limit);
  const set = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  // Recent search suggestions (text only). Recorded on blur/Enter.
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [recentOpen, setRecentOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1); // keyboard-highlighted suggestion (-1 = none)
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

  // Saved searches (named full-filter snapshots). showSaved/savedRef/manageSaved
  // are declared earlier (used by the outside-click effect / view switch).
  const [saved, setSaved] = useState<SavedSearch[]>(loadSaved);
  const persistSaved = (next: SavedSearch[]) => {
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    setSaved(next);
  };
  // Save flow: an inline name field opens pre-filled with an auto-name (focused
  // and selected), so Enter accepts as-is or typing replaces it — no ugly prompt.
  const [namingDraft, setNamingDraft] = useState<string | null>(null);
  const startNaming = () => setNamingDraft(uniqueName(defaultSavedName(filters), saved.map((s) => s.name)));
  const commitSave = () => {
    if (!anyFilter || activeSaved) return; // nothing to save / these conditions already saved
    const base = (namingDraft ?? "").trim() || defaultSavedName(filters);
    const name = uniqueName(base, saved.map((s) => s.name)); // never collide with an existing name
    persistSaved([{ id: crypto.randomUUID(), name, filters, limit }, ...saved]);
    setNamingDraft(null);
    setShowSaved(false);
  };
  const applySaved = (s: SavedSearch) => {
    leaveManageUrl(); // if applying from the manage screen, turn its /saved entry into "/"
    setFilters({ ...emptyFilters, ...s.filters }); // merge so older snapshots get new defaults
    setLimit(s.limit);
    setShowSaved(false);
    setManageSaved(false);
  };
  const renameSaved = (id: string, name: string) => persistSaved(saved.map((s) => (s.id === id ? { ...s, name } : s)));
  const deleteSaved = (id: string) => persistSaved(saved.filter((s) => s.id !== id));
  // The manage screen is its own URL (/saved) so Back/forward, reload, and the
  // Done button all work. Only the path is exposed — no query content. (The
  // server falls back to index.html for unknown paths, so /saved reloads.)
  const openManage = () => {
    setShowSaved(false);
    setManageSaved(true);
    window.history.pushState(window.history.state, "", "/saved");
  };
  // Leave /saved by replacing it with "/" (robust even if /saved was opened
  // directly); browser Back is handled separately by the popstate listener.
  const leaveManageUrl = () => {
    if (window.location.pathname === "/saved") window.history.replaceState(window.history.state, "", "/");
  };
  const closeManage = () => {
    setManageSaved(false);
    leaveManageUrl();
  };
  // The saved search the current filters/limit exactly match (if any) — drives
  // the "★ <name>" highlight instead of lighting up whenever any saved exists.
  const curKey = JSON.stringify({ filters, limit });
  const activeSaved = saved.find((s) => JSON.stringify({ filters: { ...emptyFilters, ...s.filters }, limit: s.limit }) === curKey);
  // Drop any half-typed name when the Saved dropdown closes.
  useEffect(() => {
    if (!showSaved) setNamingDraft(null);
  }, [showSaved]);

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
    if (!showFilters && !showSaved) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current && !popRef.current.contains(t)) setShowFilters(false);
      if (savedRef.current && !savedRef.current.contains(t)) setShowSaved(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showFilters, showSaved]);

  // Applied filters render as always-visible removable chips; the controls to
  // add/edit them live in the popover. Unused dimensions take no bar space.
  const removeChip = (key: string) => {
    if (key.startsWith("agent:")) set({ agents: filters.agents.filter((x) => x !== key.slice(6)) });
    else if (key.startsWith("tool:")) set({ tools: filters.tools.filter((x) => x !== key.slice(5)) });
    else if (key.startsWith("model:")) set({ models: filters.models.filter((x) => x !== key.slice(6)) });
    else if (key.startsWith("cwd:")) set({ cwds: filters.cwds.filter((x) => x !== key.slice(4)) });
    else if (key === "since") set({ since: "" });
    else if (key === "until") set({ until: "" });
    else if (key === "status") set({ archived: "all" });
    else if (key === "origin") set({ programmatic: "all" });
    else if (key === "mask") set({ mask: false });
  };
  const chips = filterChips(filters);

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
    // Filter/open snapshot lives at the root path (never the /saved manage URL).
    window.history.pushState({ agtail: snap }, "", "/");
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
      setManageSaved(window.location.pathname === "/saved"); // open/close manage to match the URL
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
  // Show matches incl. an exact match of the current text (so typing "hoge"
  // still surfaces the saved "hoge"); newest first, capped to the shown count.
  const recentMatches = recent.filter((r) => r.toLowerCase().includes(needleLc)).slice(0, RECENT_SHOWN);
  // ↓/Tab next, ↑/Shift+Tab prev, Enter accept the highlighted one, Esc close.
  const onSearchKey = (e: React.KeyboardEvent) => {
    const open = recentOpen && recentMatches.length > 0;
    if (e.key === "Escape") {
      if (recentOpen) {
        e.preventDefault(); // close the suggestions WITHOUT type=search's native clear
        setRecentOpen(false);
        setActiveIdx(-1);
      }
      return;
    }
    if (!open) return;
    const last = recentMatches.length - 1;
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, last));
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault(); // pick the highlight instead of submitting the form
      selectRecent(recentMatches[activeIdx]!);
    }
  };

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
                setActiveIdx(-1);
              }}
              onFocus={() => {
                setRecentOpen(true);
                setActiveIdx(-1);
              }}
              onKeyDown={onSearchKey}
              onBlur={() => {
                pushRecent(filters.q);
                setRecentOpen(false);
                setActiveIdx(-1);
              }}
            />
            {recentOpen && recentMatches.length > 0 && (
              <div className="recent">
                <div className="recentlist">
                  {recentMatches.map((r, i) => (
                    // mousedown (not click) + preventDefault so the input doesn't
                    // blur-and-close before the selection registers.
                    <button
                      type="button"
                      key={r}
                      className={"recentitem" + (i === activeIdx ? " active" : "")}
                      onMouseEnter={() => setActiveIdx(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectRecent(r);
                      }}
                    >
                      <span className="ric">🕘</span>
                      <span className="rtext">{r}</span>
                    </button>
                  ))}
                </div>
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
        <div className="filtermenu" ref={savedRef}>
          {/* Highlight only when the active filters match a saved search. */}
          <button
            type="button"
            className={"addfilter" + (activeSaved ? " has" : "")}
            onClick={() => setShowSaved((v) => !v)}
            title={activeSaved ? `Viewing saved search: ${activeSaved.name}` : "Saved searches"}
          >
            ★ {activeSaved ? activeSaved.name : `Saved${saved.length ? ` (${saved.length})` : ""}`}
          </button>
          {showSaved && (
            <div className="filterpop savedpop">
              {saved.length === 0 && (
                <div className="savedempty">
                  No saved searches yet. Save a set of filters/search to recall it in one click — handy for recurring
                  checks &amp; audits.
                </div>
              )}
              {saved.map((s) => (
                <button
                  type="button"
                  className={"savedapply" + (s.id === activeSaved?.id ? " on" : "")}
                  key={s.id}
                  onClick={() => applySaved(s)}
                  title="apply this search"
                >
                  ★ {s.name}
                </button>
              ))}
              {namingDraft === null ? (
                // Custom tooltip on the wrapper (the disabled button can't hover);
                // instant, unlike the native `title` which has a fixed ~1-2s delay.
                <span className="savecurwrap">
                  <button
                    type="button"
                    className="savecur"
                    disabled={!anyFilter || !!activeSaved}
                    onClick={startNaming}
                  >
                    ＋ Save current search
                  </button>
                  {(!anyFilter || activeSaved) && (
                    <span className="tip">
                      {activeSaved
                        ? `✓ These conditions are already saved as “${activeSaved.name}”.`
                        : "💡 Apply a filter or search first — then you can save it here."}
                    </span>
                  )}
                </span>
              ) : (
                <div className="naming">
                  <input
                    className="nameinput"
                    autoFocus
                    value={namingDraft}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setNamingDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitSave();
                      else if (e.key === "Escape") setNamingDraft(null);
                    }}
                    aria-label="save search as"
                  />
                  <button type="button" className="namesave" onClick={commitSave}>
                    Save
                  </button>
                </div>
              )}
              <button type="button" className="savemanage" onClick={openManage}>
                Manage saved searches →
              </button>
            </div>
          )}
        </div>
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
                <button type="button" className="x" onClick={() => removeChip(c.key)} title="remove filter">
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
      {manageSaved && (
        <ManageSaved
          saved={saved}
          onApply={applySaved}
          onRename={renameSaved}
          onDelete={deleteSaved}
          onClose={closeManage}
        />
      )}
    </div>
  );
}


