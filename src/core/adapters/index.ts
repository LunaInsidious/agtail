import type { Agent, ArchivedFilter, Session, SessionMeta } from "../types.js";
import { matchArchived } from "../types.js";
import type { Adapter, RootOverrides } from "./types.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";

export type { Adapter } from "./types.js";

/** Build all adapters (optionally with per-agent root overrides). */
export function buildAdapters(overrides: RootOverrides = {}): Adapter[] {
  return [claudeCodeAdapter(overrides["claude-code"]), codexAdapter(overrides["codex"])];
}

/** Select adapters, optionally narrowed to a subset of agents. */
export function selectAdapters(agents?: Agent[], overrides: RootOverrides = {}): Adapter[] {
  const all = buildAdapters(overrides);
  if (!agents || agents.length === 0) return all;
  const want = new Set(agents);
  return all.filter((a) => want.has(a.agent));
}

/** Cross-agent session listing, newest first. Archived sessions are included
 *  unless `archived` narrows to "only" / "none" (they are still real history). */
export async function findAllSessions(
  agents?: Agent[],
  overrides?: RootOverrides,
  archived?: ArchivedFilter,
): Promise<SessionMeta[]> {
  const adapters = selectAdapters(agents, overrides);
  const lists = await Promise.all(adapters.map((a) => a.findSessions()));
  return lists
    .flat()
    .filter((m) => matchArchived(m, archived))
    .sort((a, b) => b.mtime - a.mtime);
}

/** Resolve a session by id-prefix (and optional agent) to a full Session. */
export async function resolveSession(
  id: string,
  agents?: Agent[],
  overrides?: RootOverrides,
): Promise<Session | null> {
  const adapters = selectAdapters(agents, overrides);
  for (const a of adapters) {
    const metas = await a.findSessions();
    const hit = metas.find((m) => m.id === id) ?? metas.find((m) => m.id.startsWith(id));
    if (hit) return a.readSession(hit.path);
  }
  return null;
}
