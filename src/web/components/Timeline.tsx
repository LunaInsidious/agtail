import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Agent, Event, Session } from "../lib/api.js";
import { tag } from "../lib/filters.js";
import { originLabel, PROGRAMMATIC_TIP, pretty, type Seed } from "../lib/util.js";

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

export const Timeline = memo(function Timeline({
  session,
  seed,
  onOpenParent,
}: {
  session: Session;
  seed: Seed;
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
      if (n.has(t)) n.delete(t);
      else n.add(t);
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
    for (const e of session.events)
      if (e.kind === "hook") c.set(e.hookEvent ?? "hook", (c.get(e.hookEvent ?? "hook") ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [session]);
  const toggleHook = (t: string) =>
    setHookFocus((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
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
          {session.archived && (
            <span className="archmark" title="archived">
              🗄 archived
            </span>
          )}
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
              {u.costUsd != null
                ? `≈ $${u.costUsd.toFixed(4)}`
                : `cost unknown${u.unpricedModels.length ? ` (${u.unpricedModels.join(",")})` : ""}`}
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
              <button
                type="button"
                onClick={() => goMatch(-1)}
                disabled={!matchPositions.length}
                title="previous (Shift+Enter)"
              >
                ↑
              </button>
              <button type="button" onClick={() => goMatch(1)} disabled={!matchPositions.length} title="next (Enter)">
                ↓
              </button>
              <span className="count">{matchPositions.length ? `${cur + 1}/${matchPositions.length}` : "0/0"}</span>
              <label className={matchesOnly ? "on" : ""}>
                <input type="checkbox" checked={matchesOnly} onChange={(e) => setMatchesOnly(e.target.checked)} />{" "}
                matches only
              </label>
            </span>
          )}
          {thinkingCount > 0 && (
            <label className={showThinking ? "on" : ""}>
              <input type="checkbox" checked={showThinking} onChange={(e) => setShowThinking(e.target.checked)} />{" "}
              thinking <em>{thinkingCount}</em>
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

// eslint-disable-next-line sonarjs/cognitive-complexity -- event renderer: a switch over event kinds (text/tool/thinking/hook/system…).
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new find match should re-open; `heavy` is derived from props and must not clobber a user toggle.
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
