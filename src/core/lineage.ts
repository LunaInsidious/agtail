import type { Agent, Event, Session, SessionMeta } from "./types.js";

// Hook-spawned session lineage, reconstructed from timing — across agents.
//
// A hook can launch a headless session (e.g. a plugin's PostToolUse hook starting
// an Agent SDK review, or running `codex exec`). Neither side records the link:
// the child transcript has no parent id, and the parent's hook record carries
// only command/duration/output. What the parent DOES record (in agents that
// persist hook runs) is when and where the hook ran — normalized by the adapter
// into `Event.hookRun`, whose cwd can differ from the session's first cwd after
// a `cd` into a worktree — so a child that started inside that window, in that
// cwd, was almost certainly launched by it. Which sessions can be such a child,
// and how long the agent takes to start, are agent-specific, so each adapter
// supplies a `SpawnRule`.
//
// The link is only drawn when exactly ONE session's hook window contains the
// child's start; ambiguity leaves the child unlinked rather than guessing. Links
// are marked `parentInferred` so the UI never presents them as recorded fact.
//
// Known blind spots (verified by live runs): a hook that succeeds silently is
// not recorded by Claude Code at all, so it has no window; and a session started
// by hand (or by such an unrecorded hook) in the same cwd while another
// session's recorded hook is running is indistinguishable from its child.

/** One hook firing's run window (epoch ms) and the directory it ran in. */
export interface HookWindow {
  start: number;
  end: number;
  cwd: string;
}

/** A listed session plus its hook run windows — what an adapter's scan yields.
 *  The windows feed the cross-agent linker and are dropped from the listing. */
export type ScannedMeta = SessionMeta & { hookWindows?: HookWindow[] };

/** How an agent's sessions can be hook-launched children. */
export interface SpawnRule {
  /** Whether this session could have been launched by a hook (machine-driven). */
  isCandidate(m: SessionMeta): boolean;
  /** Slack after a hook's recorded end: a hook that detaches its child exits
   *  first, and the child's first record lands only after the agent starts up. */
  startupSlackMs: number;
}

/** The run window of a hook event, when its adapter recorded one. */
function windowOf(e: Event): HookWindow | undefined {
  if (!e.hookRun) return undefined;
  return { start: Date.parse(e.hookRun.start), end: Date.parse(e.hookRun.end), cwd: e.hookRun.cwd };
}

/** The run windows of a session's hook firings. */
export function hookWindows(events: Event[]): HookWindow[] {
  return events.map(windowOf).filter((w) => w !== undefined);
}

/** Whether child `c` (started at `t`) falls inside hook window `w`. */
const contains = (w: HookWindow, c: SessionMeta, t: number, rule: SpawnRule) =>
  w.cwd === c.cwd && w.start <= t && t <= w.end + rule.startupSlackMs;

/** Link each hook-spawn candidate (per its agent's rule, and not already linked:
 *  a recorded parent always wins) to the unique session — of ANY agent, in the
 *  same import collection — with a hook window containing its start and cwd.
 *  Returns plain metas (windows dropped) with `parentId` + `parentAgent` +
 *  `parentInferred` set on linked children. */
export function linkHookSpawns(scanned: ScannedMeta[], ruleOf: (agent: Agent) => SpawnRule | undefined): SessionMeta[] {
  return scanned.map(({ hookWindows: _windows, ...meta }) => {
    const rule = ruleOf(meta.agent);
    if (!rule || meta.parentId || !meta.started || !rule.isCandidate(meta)) return meta;
    const t = Date.parse(meta.started);
    const parents = scanned.filter(
      (p) =>
        !(p.agent === meta.agent && p.id === meta.id) &&
        p.importedFrom === meta.importedFrom &&
        (p.hookWindows ?? []).some((w) => contains(w, meta, t, rule)),
    );
    const [parent] = parents;
    return parents.length === 1 && parent
      ? { ...meta, parentId: parent.id, parentAgent: parent.agent, parentInferred: true }
      : meta;
  });
}

/** Carry a listed session's inferred lineage onto its full read, and mark the
 *  hook rows in it that launched an inferred child. `readSession` sees one file,
 *  so this cross-session context comes from the (all-agent) listing. */
export function withHookSpawnLinks(
  session: Session,
  listed: SessionMeta,
  all: SessionMeta[],
  ruleOf: (agent: Agent) => SpawnRule | undefined,
): Session {
  const children = all.filter(
    (m) => m.parentInferred && m.parentId === session.id && m.parentAgent === session.agent && m.started,
  );
  const own = listed.parentInferred
    ? { parentId: listed.parentId, parentAgent: listed.parentAgent, parentInferred: true }
    : {};
  if (children.length === 0) return { ...session, ...own };
  const launchers = new Map(children.map((c) => [c, launcherOf(session.events, c, ruleOf(c.agent))]));
  const events = session.events.map((e, i) => {
    const spawned = children
      .filter((c) => launchers.get(c) === i)
      .map((c) => ({ id: c.id, agent: c.agent, inferred: true }));
    return spawned.length ? { ...e, spawnedSessions: [...(e.spawnedSessions ?? []), ...spawned] } : e;
  });
  return { ...session, ...own, events };
}

/** The ONE hook row most likely to have launched child `c`: several windows can
 *  match (other hooks ending within the startup slack), so prefer a hook still
 *  running when the child started (latest-starting such), else the one that
 *  ended last before it. Returns its event index. */
function launcherOf(events: Event[], c: SessionMeta, rule: SpawnRule | undefined): number | undefined {
  if (!rule) return undefined;
  const t = Date.parse(c.started ?? "");
  const matches = events.flatMap((e, i) => {
    const w = windowOf(e);
    return w && contains(w, c, t, rule) ? [{ i, w, running: t <= w.end }] : [];
  });
  const running = matches.filter((m) => m.running).sort((a, b) => b.w.start - a.w.start);
  const ended = matches.filter((m) => !m.running).sort((a, b) => b.w.end - a.w.end);
  return (running[0] ?? ended[0])?.i;
}
