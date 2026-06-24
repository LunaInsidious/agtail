import { useEffect, useMemo, useState } from "react";
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
  type Match,
  type Session,
  type SessionMeta,
} from "./api.js";

const homeShort = (p: string) => p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");

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
};

export function App() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [facets, setFacets] = useState<{ tools: string[]; cwds: string[] }>({ tools: [], cwds: [] });
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [hits, setHits] = useState<Match[] | null>(null);
  const [tab, setTab] = useState<"sessions" | "hits">("sessions");
  const [cur, setCur] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

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
    apiSessions({ agents: filters.agents, cwd: filters.cwd }).then(setSessions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.agents.join(","), filters.cwd]);

  useEffect(() => {
    apiFacets().then(setFacets);
  }, []);

  async function open(agent: Agent, id: string) {
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
      setHits(await apiSearch(filters));
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
            placeholder="全セッションを横断検索…"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
          />
          <select
            className="tool"
            value={filters.tools[0] ?? ""}
            onChange={(e) => set({ tools: e.target.value ? [e.target.value] : [] })}
            title="tool"
          >
            <option value="">tool（すべて）</option>
            {facets.tools.some((t) => t.startsWith("mcp__")) && <option value="mcp__*">mcp__* (MCP すべて)</option>}
            {facets.tools.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select className="cwd" value={filters.cwd} onChange={(e) => set({ cwd: e.target.value })} title="cwd">
            <option value="">cwd（すべて）</option>
            {facets.cwds.map((c) => (
              <option key={c} value={c}>
                {homeShort(c)}
              </option>
            ))}
          </select>
          <input type="date" value={filters.since} onChange={(e) => set({ since: e.target.value })} title="since" />
          <input type="date" value={filters.until} onChange={(e) => set({ until: e.target.value })} title="until" />
          <button type="submit">検索</button>
        </form>
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
        <label className="mask">
          <input type="checkbox" checked={filters.mask} onChange={(e) => set({ mask: e.target.checked })} />
          マスク
        </label>
      </header>

      <main>
        <aside className="sidebar" style={{ flex: `0 0 ${sbWidth}px`, width: sbWidth }}>
          <div className="tabs">
            <button className={tab === "sessions" ? "on" : ""} onClick={() => setTab("sessions")}>
              セッション {sessions.length ? `(${sessions.length})` : ""}
            </button>
            <button className={tab === "hits" ? "on" : ""} onClick={() => setTab("hits")} disabled={!hits}>
              ヒット {hits ? `(${hits.length})` : ""}
            </button>
          </div>
          {tab === "sessions" ? (
            <SessionList sessions={sessions} cur={cur} onOpen={open} />
          ) : (
            <HitList hits={hits ?? []} onOpen={open} />
          )}
        </aside>
        <div className="resizer" onMouseDown={startResize} title="ドラッグで幅変更" />
        <section className="timeline">
          {loading && <div className="empty">読み込み中…</div>}
          {!loading && !cur && <div className="empty">← セッションかヒットを選んでください</div>}
          {!loading && cur && <Timeline session={cur} onOpen={open} />}
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
      className={"sess" + (child ? " child" : "") + (cur && cur.id === s.id ? " active" : "")}
      onClick={() => onOpen(s.agent, s.id)}
    >
      <div className="row1">
        {child && <span className="branch">↳</span>}
        <span className={"src " + s.agent}>{tag(s.agent)}</span>
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
  if (!sessions.length) return <div className="empty">なし</div>;
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

function HitList({ hits, onOpen }: { hits: Match[]; onOpen: (a: Agent, id: string) => void }) {
  if (!hits.length) return <div className="empty">一致なし</div>;
  return (
    <>
      {hits.map((m, i) => (
        <div key={i} className="hit" onClick={() => onOpen(m.agent, m.sessionId)}>
          <div className="row1">
            <span className={"src " + m.agent}>{tag(m.agent)}</span>
            <span className="sid">{m.sessionId.slice(0, 8)}</span>
            <span>{fmtTs(m.ts)}</span>
            <span className="kind">{m.kind}</span>
            {m.tool && <span className="tool">{m.tool}</span>}
          </div>
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

function Timeline({ session, onOpen }: { session: Session; onOpen: (a: Agent, id: string) => void }) {
  const [toolFilter, setToolFilter] = useState<Set<string>>(new Set());
  const [showThinking, setShowThinking] = useState(true);
  const [showMeta, setShowMeta] = useState(false);
  const [find, setFind] = useState("");

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
  const needle = find.trim();
  const visible = session.events.filter((e) => {
    if (e.kind === "thinking" && !showThinking) return false;
    if ((e.kind === "system" || e.kind === "unknown" || e.kind === "summary") && !showMeta) return false;
    if (toolFilter.size && !(e.kind === "tool_use" && e.tool && toolFilter.has(e.tool))) return false;
    if (needle && !eventText(e).toLowerCase().includes(needle.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <div className="thead">
      <div className="meta">
        <span className={"src " + session.agent}>{tag(session.agent)}</span>
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
            {u.costUsd != null ? `≈ $${u.costUsd.toFixed(4)}` : `cost不明${u.unpricedModels.length ? ` (${u.unpricedModels.join(",")})` : ""}`}
          </span>
        )}
      </div>
      <div className="controls">
        <input
          type="search"
          className="insearch"
          placeholder="このセッション内を検索"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        {needle && <span className="count">{visible.length}件</span>}
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
          <EventRow key={i} e={e} highlight={needle} />
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
      {e.tokens.toLocaleString()} tok{e.cost != null ? ` · $${e.cost.toFixed(4)}` : " · cost不明"}
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
      {open ? "▲ 折りたたむ" : `▼ 全部表示 (${text.length.toLocaleString()}字)`}
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
