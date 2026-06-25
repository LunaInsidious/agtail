import { useEffect, useMemo, useRef, useState } from "react";
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

const homeShort = (p: string) => p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");

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

const emptyFilters: Filters = {
  q: "",
  agents: [],
  tools: [],
  cwd: "",
  since: "",
  until: "",
  kinds: [],
  mask: false,
  archived: "all",
};

export function App() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [facets, setFacets] = useState<{ tools: string[]; cwds: string[] }>({ tools: [], cwds: [] });
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [hits, setHits] = useState<SessionHit[] | null>(null);
  const [tab, setTab] = useState<"sessions" | "hits">("sessions");
  const [cur, setCur] = useState<Session | null>(null);
  const [seed, setSeed] = useState<Seed>({ find: "" });
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const set = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  // Status filter mirrors the agent toggles: two chips (active / archived) where
  // neither-or-both selected means "all", matching the agents "none = all" idiom.
  const toggleStatus = (k: "active" | "archived") => {
    let active = filters.archived === "none";
    let archived = filters.archived === "only";
    if (k === "active") active = !active;
    else archived = !archived;
    set({ archived: active && !archived ? "none" : archived && !active ? "only" : "all" });
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
  if (filters.cwd) chips.push({ key: "cwd", label: "📁 " + homeShort(filters.cwd), onRemove: () => set({ cwd: "" }) });
  if (filters.since) chips.push({ key: "since", label: "≥ " + filters.since, onRemove: () => set({ since: "" }) });
  if (filters.until) chips.push({ key: "until", label: "≤ " + filters.until, onRemove: () => set({ until: "" }) });
  if (filters.archived !== "all")
    chips.push({
      key: "status",
      label: filters.archived === "only" ? "🗄 archived" : "active only",
      onRemove: () => set({ archived: "all" }),
    });
  if (filters.mask) chips.push({ key: "mask", label: "🔒 mask", onRemove: () => set({ mask: false }) });

  const clearAll = () =>
    set({ agents: [], tools: [], cwd: "", since: "", until: "", archived: "all", mask: false });

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

  useEffect(() => {
    apiSessions({ agents: filters.agents, cwd: filters.cwd, archived: filters.archived }).then(setSessions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.agents.join(","), filters.cwd, filters.archived]);

  useEffect(() => {
    apiFacets().then(setFacets);
  }, []);

  async function open(agent: Agent, id: string, withSeed?: Seed) {
    setSeed(withSeed ?? { find: "" });
    setLoading(true);
    try {
      setCur(await apiSession(agent, id, filters.mask));
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    try {
      setHits(await apiSearch(filters, limit));
      setTab("hits");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header>
        <span className="brand">
          <b>≋</b> agtail
        </span>
        <form className="search" onSubmit={runSearch}>
          <input
            type="search"
            placeholder="Search across all sessions…"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
          />
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
              <div className="frow">
                <span className="lbl">tool</span>
                <select
                  value={filters.tools[0] ?? ""}
                  onChange={(e) => set({ tools: e.target.value ? [e.target.value] : [] })}
                >
                  <option value="">all</option>
                  {facets.tools.some((t) => t.startsWith("mcp__")) && <option value="mcp__*">mcp__* (all MCP)</option>}
                  {facets.tools.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="frow">
                <span className="lbl">project (cwd)</span>
                <select value={filters.cwd} onChange={(e) => set({ cwd: e.target.value })}>
                  <option value="">all</option>
                  {facets.cwds.map((c) => (
                    <option key={c} value={c}>
                      {homeShort(c)}
                    </option>
                  ))}
                </select>
              </div>
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
          <div className="tabs">
            <button className={tab === "sessions" ? "on" : ""} onClick={() => setTab("sessions")}>
              Sessions {sessions.length ? `(${sessions.length})` : ""}
            </button>
            {hits && (
              <button className={tab === "hits" ? "on" : ""} onClick={() => setTab("hits")}>
                Hits {`(${hits.length}${truncated ? "+" : ""})`}
              </button>
            )}
          </div>
          {tab === "sessions" ? (
            <SessionList sessions={sessions} cur={cur} onOpen={open} />
          ) : (
            <HitList
              hits={hits ?? []}
              truncated={truncated}
              seed={{ find: filters.q, tool: filters.tools[0] }}
              onOpen={open}
            />
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
          {!loading && cur && <Timeline session={cur} seed={seed} onOpen={open} />}
        </section>
      </main>
    </div>
  );
}

function SessionRow({
  s,
  cur,
  onOpen,
  child,
}: {
  s: SessionMeta;
  cur: Session | null;
  onOpen: (a: Agent, id: string) => void;
  child?: boolean;
}) {
  return (
    <div
      className={"sess" + (child ? " child" : "") + (s.archived ? " archived" : "") + (cur && cur.id === s.id ? " active" : "")}
      onClick={() => onOpen(s.agent, s.id)}
    >
      <div className="row1">
        {child && <span className="branch">↳</span>}
        <span className={"src " + s.agent}>{tag(s.agent)}</span>
        {s.archived && <span className="archmark" title="archived">🗄</span>}
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

function SessionList({
  sessions,
  cur,
  onOpen,
}: {
  sessions: SessionMeta[];
  cur: Session | null;
  onOpen: (a: Agent, id: string) => void;
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
  const props = { cur, onOpen };
  return (
    <>
      {sessions.map((s) => {
        if (s.isSubagent) {
          // Orphan (parent filtered out): show standalone so it's not lost.
          return s.parentId && present.has(s.parentId) ? null : (
            <SessionRow key={s.agent + s.id} s={s} child {...props} />
          );
        }
        const kids = childrenOf.get(s.id) ?? [];
        return (
          <div key={s.agent + s.id}>
            <SessionRow s={s} {...props} />
            {kids.map((c) => (
              <SessionRow key={c.agent + c.id} s={c} child {...props} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function HitList({
  hits,
  truncated,
  seed,
  onOpen,
}: {
  hits: SessionHit[];
  truncated: boolean;
  seed: Seed;
  onOpen: (a: Agent, id: string, seed?: Seed) => void;
}) {
  if (!hits.length) return <div className="empty">No matches</div>;
  return (
    <>
      {truncated && (
        <div className="trunc">
          Showing the first {hits.length} sessions — raise “max results” or refine your search to see more.
        </div>
      )}
      {hits.map((m) => (
        <div
          key={m.agent + m.sessionId}
          className={"hit" + (m.archived ? " archived" : "")}
          onClick={() => onOpen(m.agent, m.sessionId, seed)}
        >
          <div className="row1">
            <span className={"src " + m.agent}>{tag(m.agent)}</span>
            {m.archived && <span className="archmark" title="archived">🗄</span>}
            <span className="sid">{m.sessionId.slice(0, 8)}</span>
            <span>{fmtTs(m.ts)}</span>
            <span className="matchn" title="matching events">{m.matchCount} match{m.matchCount === 1 ? "" : "es"}</span>
          </div>
          <div className="title">{m.title}</div>
          <div className="snippet">{m.snippet}</div>
        </div>
      ))}
    </>
  );
}

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

function Timeline({
  session,
  seed,
  onOpen,
}: {
  session: Session;
  seed: Seed;
  onOpen: (a: Agent, id: string, seed?: Seed) => void;
}) {
  const [toolFilter, setToolFilter] = useState<Set<string>>(() => seedTools(seed));
  const [showThinking, setShowThinking] = useState(true);
  const [showMeta, setShowMeta] = useState(false);
  const [find, setFind] = useState(seed.find);
  // Text find is non-destructive by default (highlight + jump); "matches only"
  // collapses the timeline to just the matching events.
  const [matchesOnly, setMatchesOnly] = useState(false);
  const [activeMatch, setActiveMatch] = useState(0);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Re-apply the search context carried from a hit whenever a new session opens.
  useEffect(() => {
    setFind(seed.find);
    setToolFilter(seedTools(seed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

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
  const needle = find.trim().toLowerCase();

  // Events left after the explicit subsetting filters (thinking/meta/tool). The
  // text find does NOT subset here — it highlights + navigates over this set.
  const base = session.events.filter((e) => {
    if (e.kind === "thinking" && !showThinking) return false;
    if ((e.kind === "system" || e.kind === "unknown" || e.kind === "summary") && !showMeta) return false;
    if (toolFilter.size && !(e.kind === "tool_use" && e.tool && toolFilter.has(e.tool))) return false;
    return true;
  });
  const isMatch = (e: Event) => !!needle && eventText(e).toLowerCase().includes(needle);
  const visible = needle && matchesOnly ? base.filter(isMatch) : base;
  // Indices into `visible` that contain the needle, for the jump counter/nav.
  const matchIdxs = needle ? visible.map((e, i) => (isMatch(e) ? i : -1)).filter((i) => i >= 0) : [];
  const cur = matchIdxs.length ? Math.min(activeMatch, matchIdxs.length - 1) : 0;
  const goMatch = (delta: number) =>
    matchIdxs.length && setActiveMatch((a) => (a + delta + matchIdxs.length) % matchIdxs.length);

  // Reset to the first match when the query or the visible set changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setActiveMatch(0), [needle, matchesOnly, showThinking, showMeta, toolFilter, session.id]);
  // Scroll the active match into view as it changes.
  useEffect(() => {
    const target = matchIdxs[cur];
    if (target != null) rowRefs.current[target]?.scrollIntoView({ block: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, needle, matchesOnly]);

  return (
    <>
      <div className="thead">
      <div className="meta">
        <span className={"src " + session.agent}>{tag(session.agent)}</span>
        {session.archived && <span className="archmark" title="archived">🗄 archived</span>}
        {session.isSubagent && (
          <span className="subof">
            ↳ subagent{session.agentName ? ` (${session.agentName})` : ""} of{" "}
            <a onClick={() => session.parentId && onOpen(session.agent, session.parentId)}>
              {session.parentId?.slice(0, 8)}
            </a>
          </span>
        )}
        <code>{session.id.slice(0, 8)}</code>
        <span>{session.cwd}</span>
        <span>{session.gitBranch ?? "-"}</span>
        <span>{session.model ?? ""}</span>
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
            <button type="button" onClick={() => goMatch(-1)} disabled={!matchIdxs.length} title="previous (Shift+Enter)">
              ↑
            </button>
            <button type="button" onClick={() => goMatch(1)} disabled={!matchIdxs.length} title="next (Enter)">
              ↓
            </button>
            <span className="count">{matchIdxs.length ? `${cur + 1}/${matchIdxs.length}` : "0/0"}</span>
            <label className={matchesOnly ? "on" : ""}>
              <input type="checkbox" checked={matchesOnly} onChange={(e) => setMatchesOnly(e.target.checked)} /> matches only
            </label>
          </span>
        )}
        <label className={showThinking ? "on" : ""}>
          <input type="checkbox" checked={showThinking} onChange={(e) => setShowThinking(e.target.checked)} /> thinking
        </label>
        <label className={showMeta ? "on" : ""}>
          <input type="checkbox" checked={showMeta} onChange={(e) => setShowMeta(e.target.checked)} /> system/meta
        </label>
        {tools.map(([t, n]) => (
          <button key={t} className={"chip" + (toolFilter.has(t) ? " on" : "")} onClick={() => toggle(t)}>
            {t} <em>{n}</em>
          </button>
        ))}
      </div>
      </div>
      <div className="events">
        {visible.map((e, i) => (
          <div
            key={i}
            ref={(el) => (rowRefs.current[i] = el)}
            className={"evrow" + (needle && matchIdxs[cur] === i ? " active" : "")}
          >
            <EventRow e={e} highlight={needle} />
          </div>
        ))}
      </div>
    </>
  );
}

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

function EventRow({ e, highlight }: { e: Event; highlight?: string }) {
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
  if (e.kind === "unknown") {
    return (
      <div className="ev unknown">
        <div className="sig">?</div>
        <div className="body">
          <span className="role">unknown · {e.text}</span>
          <Collapsible text={pretty(e.raw)} collapsed highlight={highlight} />
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
}

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
