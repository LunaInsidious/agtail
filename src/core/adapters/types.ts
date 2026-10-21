import type { Agent, Session } from "../types.js";
import type { ScannedMeta, SpawnRule } from "../lineage.js";

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
  /** Lightweight scan of all sessions for listings/search indexing. An agent
   *  that records hook runs attaches each session's `hookWindows` (consumed by
   *  the cross-agent lineage linker in adapters/index.ts, then dropped). */
  findSessions(): Promise<ScannedMeta[]>;
  /** Fully read + normalize one session file. */
  readSession(path: string): Promise<Session>;
  /** Absolute paths of all native transcript files to export (NOT the import
   *  store — export only re-exports native sessions). */
  transferFiles(): Promise<string[]>;
  /** Optional: render a one-line summary of a tool_use input for this agent's own
   *  tools. Return undefined to defer to the core summarizer (core/format.ts
   *  summarizeInput). Lets an adapter present exotic tools instead of raw JSON. */
  describeTool?(tool: string | undefined, input: unknown): string | undefined;
  /** Optional: which of this agent's sessions a hook (of any agent) could have
   *  launched, and how long it takes to start (core/lineage.ts). Absent = its
   *  sessions are never inferred children. */
  spawnRule?: SpawnRule;
}

/** Per-agent root overrides (from --dir / --claude-dir / --codex-dir), keyed by agent. */
export type RootOverrides = Partial<Record<Agent, string>>;

/** Builds the set of in-tree adapters (optionally honoring per-agent root overrides). */
export type AdapterFactory = (overrides: RootOverrides) => Adapter[];
