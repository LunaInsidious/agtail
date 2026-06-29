import { memo, useEffect, useRef } from "react";
import type { Agent, Session, SessionHit, SessionMeta } from "../lib/api.js";
import { tag } from "../lib/filters.js";
import { fmtTs, originLabel, PROGRAMMATIC_TIP, type Seed } from "../lib/util.js";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollTarget is a ref and s.id is constant per row; only `active` flipping should scroll.
  }, [active]);
  return (
    <div
      ref={ref}
      className={
        "sess" + (child ? " child" : "") + (s.archived || s.programmatic ? " dim" : "") + (active ? " active" : "")
      }
      onClick={() => onOpen(s.agent, s.id)}
    >
      <div className="row1">
        {child && <span className="branch">↳</span>}
        <span className={"src " + s.agent}>{tag(s.agent)}</span>
        {s.archived && (
          <span className="archmark" title="archived">
            🗄
          </span>
        )}
        {s.imported && (
          <span className="archmark" title={`imported from ${s.importedFrom ?? "another machine"}`}>
            📥 {s.importedFrom ?? "imported"}
          </span>
        )}
        {s.programmatic && (
          <span className="automark" title={PROGRAMMATIC_TIP}>
            🤖 {originLabel(s.origin)}
            {s.spawnedBy && (
              <span className="spawnby" title={`spawned by the ${s.spawnedBy} plugin`}>
                {" "}
                · 🧩 {s.spawnedBy}
              </span>
            )}
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

export const SessionList = memo(function SessionList({
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollTarget is a ref and m.sessionId is constant per row; only `active` flipping should scroll.
  }, [active]);
  return (
    <div
      ref={ref}
      className={
        "hit" + (child ? " child" : "") + (m.archived || m.programmatic ? " dim" : "") + (active ? " active" : "")
      }
      onClick={() => onOpen(m.agent, m.sessionId, seed)}
    >
      <div className="row1">
        {child && <span className="branch">↳</span>}
        <span className={"src " + m.agent}>{tag(m.agent)}</span>
        {m.archived && (
          <span className="archmark" title="archived">
            🗄
          </span>
        )}
        {m.imported && (
          <span className="archmark" title={`imported from ${m.importedFrom ?? "another machine"}`}>
            📥 {m.importedFrom ?? "imported"}
          </span>
        )}
        {m.programmatic && (
          <span className="automark" title={PROGRAMMATIC_TIP}>
            🤖 {originLabel(m.origin)}
            {m.spawnedBy && (
              <span className="spawnby" title={`spawned by the ${m.spawnedBy} plugin`}>
                {" "}
                · 🧩 {m.spawnedBy}
              </span>
            )}
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

export const HitList = memo(function HitList({
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
      <div className="empty">
        <span className="spinner" /> Searching…
      </div>
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
