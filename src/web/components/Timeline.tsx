import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { Agent, Event, Session } from "../lib/api.js";
import { tag } from "../lib/filters.js";
import { originLabel, PROGRAMMATIC_TIP, type Seed } from "../lib/util.js";
import { EventRow, eventText } from "./EventRow.js";

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
      const t = e.target instanceof Node ? e.target : null;
      if (toolsRef.current && !toolsRef.current.contains(t)) setShowTools(false);
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

  const matchesAt = (i: number) => !!needle && (searchText[i] ?? "").includes(needle);
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
  const activePos = needle && matchPositions.length ? (matchPositions[cur] ?? -1) : -1;
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
        itemContent={(index, oi) => {
          const ev = session.events[oi];
          return (
            <div className={"evrow" + (index === activePos ? " active" : "")}>
              {/* Highlight only matching rows so non-matching rows skip re-render. */}
              {ev && <EventRow e={ev} highlight={matchesAt(oi) ? needle : undefined} />}
            </div>
          );
        }}
      />
    </>
  );
});
