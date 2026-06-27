import { useEffect, useRef, useState } from "react";
import { apiFacets, apiSearch, apiSessions, type Filters, type SessionHit, type SessionMeta } from "./lib/api.js";
import { filterChips, homeShort, tag } from "./lib/filters.js";
import { AGENTS, LIMIT_OPTIONS, readHistory } from "./lib/state.js";
import { CheckList } from "./components/CheckList.js";
import { ManageSaved } from "./components/ManageSaved.js";
import { HitList, SessionList } from "./components/SessionList.js";
import { Timeline } from "./components/Timeline.js";
import { useOpenSession } from "./hooks/useOpenSession.js";
import { useSavedSearches } from "./hooks/useSavedSearches.js";
import { useRecentSearches } from "./hooks/useRecentSearches.js";
import { useHistoryNav } from "./hooks/useHistoryNav.js";

// eslint-disable-next-line sonarjs/cognitive-complexity -- root container: breadth of UI state and handlers; already decomposed into hooks/ and components/. Ratchet target.
export function App() {
  const [filters, setFilters] = useState<Filters>(() => readHistory().filters);
  const [facets, setFacets] = useState<{ tools: string[]; cwds: string[]; models: string[] }>({
    tools: [],
    cwds: [],
    models: [],
  });
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [hits, setHits] = useState<SessionHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0); // guards against stale (out-of-order) search resolutions
  const sessionsSeq = useRef(0); // same, for the session-list fetch
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState<number>(() => readHistory().limit);
  const set = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

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

  // Opening a session (cur/seed/loading) with an LRU + stale-while-revalidate cache.
  const { cur, setCur, seed, loading, open, openParent, scrollTargetRef } = useOpenSession(
    filters.mask,
    hits,
    setFilters,
  );

  // Saved searches + the /saved manage screen.
  const {
    saved,
    showSaved,
    setShowSaved,
    manageSaved,
    setManageSaved,
    namingDraft,
    setNamingDraft,
    savedRef,
    activeSaved,
    startNaming,
    commitSave,
    applySaved,
    renameSaved,
    deleteSaved,
    openManage,
    closeManage,
  } = useSavedSearches({ filters, limit, anyFilter, setFilters, setLimit });

  // Recent text-search suggestions under the search box.
  const {
    recentOpen,
    setRecentOpen,
    activeIdx,
    setActiveIdx,
    recentMatches,
    pushRecent,
    clearRecent,
    selectRecent,
    onSearchKey,
  } = useRecentSearches(filters.q, (q) => set({ q }));

  // Browser history (back/forward + reload) carries filters, limit, open session.
  useHistoryNav({ filters, limit, cur, open, setFilters, setLimit, setCur, setManageSaved });

  // Status filter mirrors the agent toggles: two chips (active / archived) where
  // neither-or-both selected means "all", matching the agents "none = all" idiom.
  const toggleStatus = (k: "active" | "archived") => {
    const active = (filters.archived === "none") !== (k === "active");
    const archived = (filters.archived === "only") !== (k === "archived");
    set({ archived: active && !archived ? "none" : archived && !active ? "only" : "all" });
  };

  // Origin filter (interactive vs programmatic), same none/both = all idiom.
  const toggleOrigin = (k: "interactive" | "programmatic") => {
    const interactive = (filters.programmatic === "none") !== (k === "interactive");
    const programmatic = (filters.programmatic === "only") !== (k === "programmatic");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setShowSaved/savedRef (from useSavedSearches) are a stable setter + ref; the listener only needs re-binding when a popover toggles.
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
    set({
      agents: [],
      tools: [],
      models: [],
      cwds: [],
      since: "",
      until: "",
      archived: "all",
      programmatic: "all",
      mask: false,
    });

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

  // A signature of every field the live search depends on, so the effect's
  // dependency list is one statically-checkable value rather than inline joins.
  const searchSig = JSON.stringify([
    anyFilter,
    filters.q,
    filters.agents,
    filters.tools,
    filters.models,
    filters.cwds,
    filters.since,
    filters.until,
    filters.kinds,
    filters.mask,
    filters.archived,
    filters.programmatic,
    limit,
  ]);

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
        .then((h) => {
          if (searchSeq.current === seq) setHits(h);
        })
        .finally(() => {
          if (searchSeq.current === seq) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchSig encodes every field below; the effect closes over `filters`/`limit` directly.
  }, [searchSig]);

  // Enter / Search button: run immediately (skip the debounce).
  function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    pushRecent(filters.q);
    setRecentOpen(false);
    if (!anyFilter) return;
    setSearching(true);
    const seq = ++searchSeq.current;
    apiSearch(filters, limit)
      .then((h) => {
        if (searchSeq.current === seq) setHits(h);
      })
      .finally(() => {
        if (searchSeq.current === seq) setSearching(false);
      });
  }

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
                  ...(facets.tools.some((t) => t.startsWith("mcp__"))
                    ? [{ value: "mcp__*", label: "mcp__* (all MCP)" }]
                    : []),
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
                  <input
                    type="date"
                    value={filters.since}
                    onChange={(e) => set({ since: e.target.value })}
                    title="since"
                  />
                  <input
                    type="date"
                    value={filters.until}
                    onChange={(e) => set({ until: e.target.value })}
                    title="until"
                  />
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
                            agents: e.target.checked ? [...filters.agents, a] : filters.agents.filter((x) => x !== a),
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
                    <input
                      type="checkbox"
                      checked={filters.archived === "none"}
                      onChange={() => toggleStatus("active")}
                    />
                    active
                  </label>
                  <label className={filters.archived === "only" ? "on" : ""}>
                    <input
                      type="checkbox"
                      checked={filters.archived === "only"}
                      onChange={() => toggleStatus("archived")}
                    />
                    🗄 archived
                  </label>
                </span>
              </div>
              <div className="frow">
                <span className="lbl">origin</span>
                <span className="agents">
                  <label className={filters.programmatic === "none" ? "on" : ""}>
                    <input
                      type="checkbox"
                      checked={filters.programmatic === "none"}
                      onChange={() => toggleOrigin("interactive")}
                    />
                    interactive
                  </label>
                  <label className={filters.programmatic === "only" ? "on" : ""}>
                    <input
                      type="checkbox"
                      checked={filters.programmatic === "only"}
                      onChange={() => toggleOrigin("programmatic")}
                    />
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
          {!loading && cur && <Timeline session={cur} seed={seed} onOpenParent={openParent} />}
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
