import { memo, useEffect, useRef } from "react";
import type { Agent, Session, SessionHit, SessionMeta } from "../lib/api.js";
import { tag } from "../lib/filters.js";
import { fmtTs, INFERRED_PARENT_TIP, originLabel, PROGRAMMATIC_TIP, type Seed } from "../lib/util.js";

/** Items nested under their parent (subagents, hook-launched sessions) to any
 *  depth — a subagent's hook can launch a session too. A child whose parent isn't
 *  listed shows flat at the top level, NOT indented: otherwise it would look
 *  nested under the unrelated row above it. */
function nestTree<T>(
  items: T[],
  idOf: (t: T) => string,
  parentOf: (t: T) => string | undefined,
): { item: T; depth: number }[] {
  const present = new Set(items.map(idOf));
  const nested = (t: T) => {
    const p = parentOf(t);
    return p !== undefined && present.has(p);
  };
  const childrenOf = new Map<string, T[]>();
  for (const t of items) {
    const p = parentOf(t);
    if (p !== undefined && present.has(p)) childrenOf.set(p, [...(childrenOf.get(p) ?? []), t]);
  }
  const walk = (t: T, depth: number): { item: T; depth: number }[] => [
    { item: t, depth },
    ...(childrenOf.get(idOf(t)) ?? []).flatMap((c) => walk(c, depth + 1)),
  ];
  return items.filter((t) => !nested(t)).flatMap((t) => walk(t, 0));
}

/** Indent + branch marker for a nested row (↳ recorded, ⇢ inferred parent). */
function Branch({ depth, inferred }: { depth: number; inferred?: boolean }) {
  if (depth === 0) return null;
  return inferred ? (
    <span className="branch" title={INFERRED_PARENT_TIP}>
      ⇢
    </span>
  ) : (
    <span className="branch">↳</span>
  );
}
// Nested rows indent one step per level beyond the first (which .child pads).
const indent = (depth: number) => (depth > 1 ? { paddingLeft: 26 + (depth - 1) * 14 } : undefined);

function SessionRow({
  s,
  cur,
  onOpen,
  scrollTarget,
  depth,
}: {
  s: SessionMeta;
  cur: Session | null;
  onOpen: (a: Agent, id: string) => void;
  scrollTarget: React.MutableRefObject<string | null>;
  depth: number;
}) {
  const child = depth > 0;
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
      style={indent(depth)}
      onClick={() => onOpen(s.agent, s.id)}
    >
      <div className="row1">
        <Branch depth={depth} inferred={s.parentInferred} />
        <span className={"src " + s.agent}>{tag(s.agent)}</span>
        {s.archived && (
          <span className="archmark" title="archived">
            🗄
          </span>
        )}
        {s.imported && (
          <span className="archmark imported" title={`imported from ${s.importedFrom ?? "another machine"}`}>
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
        <span>{s.messages} events</span>
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
  const props = { cur, onOpen, scrollTarget };
  return (
    <>
      {nestTree(
        sessions,
        (s) => s.id,
        (s) => s.parentId,
      ).map(({ item: s, depth }) => (
        // Key on the file path: unique per session file even if two rollouts
        // ever resolve to the same id, so React never strands stale rows.
        <SessionRow key={s.path} s={s} depth={depth} {...props} />
      ))}
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
  depth,
}: {
  m: SessionHit;
  cur: Session | null;
  seed: Seed;
  onOpen: (a: Agent, id: string, seed?: Seed) => void;
  scrollTarget: React.MutableRefObject<string | null>;
  showMatch: boolean;
  depth: number;
}) {
  const child = depth > 0;
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
      style={indent(depth)}
      onClick={() => onOpen(m.agent, m.sessionId, seed)}
    >
      <div className="row1">
        <Branch depth={depth} inferred={m.parentInferred} />
        <span className={"src " + m.agent}>{tag(m.agent)}</span>
        {m.archived && (
          <span className="archmark" title="archived">
            🗄
          </span>
        )}
        {m.imported && (
          <span className="archmark imported" title={`imported from ${m.importedFrom ?? "another machine"}`}>
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
  // Nest a matched child under its matched parent; one whose parent isn't among
  // the results shows standalone (flat). Same rule as the browse list — only
  // nodes that actually matched appear.
  const rowProps = { cur, seed, onOpen, scrollTarget, showMatch };
  return (
    <>
      {searching && <div className="searchbar" />}
      {truncated && (
        <div className="trunc">
          Showing the first {hits.length} sessions — raise “max results” or refine your search to see more.
        </div>
      )}
      {nestTree(
        hits,
        (m) => m.sessionId,
        (m) => m.parentId,
      ).map(({ item: m, depth }) => (
        <HitRow key={m.path} m={m} depth={depth} {...rowProps} />
      ))}
    </>
  );
});
