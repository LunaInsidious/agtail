import type { Agent, Session, SessionMeta } from "../types.js";

/**
 * One adapter per coding agent. It knows where that agent stores transcripts
 * and how to normalize them into agtail's shared model. Adapters are read-only.
 */
export interface Adapter {
  agent: Agent;
  /** The agent's canonical base dir (e.g. ~/.claude), = dirname(root). Computed
   *  at construction regardless of existence; export rel paths are relative to it. */
  base: string;
  /** Existing root directories to scan (already filtered for existence). */
  roots(): string[];
  /** Lightweight scan of all sessions for listings/search indexing. */
  findSessions(): Promise<SessionMeta[]>;
  /** Fully read + normalize one session file. */
  readSession(path: string): Promise<Session>;
  /** Absolute paths of all native transcript files to export (NOT the import
   *  store — export only re-exports native sessions). */
  transferFiles(): Promise<string[]>;
}

/** Per-agent root overrides (from --dir), keyed by agent. */
export type RootOverrides = Partial<Record<Agent, string>>;
