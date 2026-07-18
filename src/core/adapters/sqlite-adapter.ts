import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { expandHome } from "../walk.js";
import type { Session, SessionMeta } from "../types.js";
import type { Adapter } from "./types.js";

// A ready-made Adapter for agents that keep their history in a single SQLite DB
// with many sessions as rows (OpenCode, Goose, Cursor, …). It handles opening the
// DB read-only via Node's built-in `node:sqlite` (no dependency; loaded lazily so
// only agents that use it pay the experimental-feature warning), missing-file
// tolerance, the synthetic path <-> id mapping, and the registry plumbing. The
// author writes the two agent-specific queries: `listSessions` and `readSession`.
//
// Unlike fileAdapter there is no per-session native file, so export
// (transferFiles) is not supported — DB-backed sessions are viewable, not
// re-exportable, in this version.

/** SQLite scalar accepted as a bound parameter. */
type SqliteValue = null | number | bigint | string | Uint8Array;

/** A prepared statement — the subset of node:sqlite's StatementSync used here. */
interface SqliteStatement {
  all(...params: SqliteValue[]): unknown[];
  get(...params: SqliteValue[]): unknown;
}

/**
 * Read-only DB handle passed to an adapter's query callbacks. Rows come
 * back as plain objects; narrow their fields yourself (they are `unknown`).
 */
export interface SqliteReader {
  prepare(sql: string): SqliteStatement;
}

/** Configuration for {@link sqliteAdapter}. */
export interface SqliteAdapterConfig {
  /** The agent id these sessions belong to. */
  agent: string;
  /** Path to the SQLite database file (a leading ~ is expanded). */
  db: string;
  /** Export base for relative paths (default: the parent dir of `db`). */
  base?: string;
  /** Return one lightweight descriptor per session. `path` is set by the helper —
   *  just fill `id` (and the other meta fields). */
  listSessions: (db: SqliteReader) => SessionMeta[];
  /** Fully read one session by the id returned from `listSessions`. */
  readSession: (db: SqliteReader, id: string) => Session;
}

const SEP = "#"; // synthetic path = `${dbPath}#${id}` (dbPath has no '#')

export function sqliteAdapter(cfg: SqliteAdapterConfig): Adapter {
  const dbPath = expandHome(cfg.db);
  const prefix = `${dbPath}${SEP}`;

  const withDb = async <T>(fn: (db: SqliteReader) => T): Promise<T | null> => {
    if (!existsSync(dbPath)) return null;
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return fn(raw);
    } finally {
      raw.close();
    }
  };

  return {
    agent: cfg.agent,
    base: cfg.base === undefined ? dirname(dbPath) : expandHome(cfg.base),
    roots: () => (existsSync(dbPath) ? [dbPath] : []),
    async findSessions(): Promise<SessionMeta[]> {
      const metas = await withDb((db) => cfg.listSessions(db));
      return (metas ?? []).map((m) => ({ ...m, path: `${prefix}${m.id}` }));
    },
    async readSession(path: string): Promise<Session> {
      const id = path.startsWith(prefix) ? path.slice(prefix.length) : path;
      const sess = await withDb((db) => cfg.readSession(db, id));
      if (sess === null) throw new Error(`sqlite db not found: ${dbPath}`);
      return sess;
    },
    transferFiles: () => Promise.resolve([]),
  };
}
