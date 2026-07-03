import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { expandHome, mtimeMs, walkFiles } from "../walk.js";
import { collectionDir, collectionOf, listCollections } from "../imported.js";
import { hasContent } from "../format.js";
import { collectJsonl } from "../jsonl.js";
import { tagIntegrity } from "./utils.js";
import type { Event, Session, SessionMeta } from "../types.js";
import type { Adapter } from "./types.js";

// A ready-made Adapter for the common case: a directory tree where each session
// is one unit — either one FILE (JSONL or whole-JSON) or one DIRECTORY (a folder
// of files per task/conversation). It absorbs the fs boilerplate the built-ins
// repeat (discovery, the agtail import-store scan, archived tagging, empty-stub
// skip, ~ expansion, meta-stripping) so a new in-tree adapter writes only the mapping.
//
// Pick a discovery unit (`unit`) and exactly one read mode:
//   - parse     — unit:"file", one JSONL file per session (Codex, Gemini CLI)
//   - parseJson — unit:"file", one whole-JSON file per session (Continue)
//   - read      — any unit, full control (dir-per-task: Cline/Roo; event-stream:
//                 OpenHands; or any custom read of a file/dir → Session)
//
// The one shape it does NOT model is "a single file holding MANY sessions"
// (e.g. Aider's .aider.chat.history.md) — that breaks unit == session; implement
// the Adapter interface directly for those.

/** File facts the helper already knows; `id` is a filename/dirname-derived
 *  FALLBACK — the authoritative id is whatever the mapping returns in
 *  `Session.id` (some agents store it inside the records; cf. Codex session_meta). */
export interface FileParseCtx {
  id: string;
  path: string;
  mtime: number;
}

/**
 * Build a full Session from just the events — the helper derives the
 * boilerplate (title = first user line, started/ended = first/last event ts,
 * models = distinct event models, messages = event count). So an adapter's `parse`
 * can be `(lines, ctx) => buildSession(ctx, lines.map(toEvent))` and nothing more.
 * `agent` is filled in by fileAdapter if you leave it off.
 */
export function buildSession(
  ctx: FileParseCtx,
  events: Event[],
  extra: { agent?: string; cwd?: string; title?: string; gitBranch?: string; version?: string } = {},
): Session {
  const models: string[] = [];
  for (const e of events) if (e.model && !models.includes(e.model)) models.push(e.model);
  const tss = events.map((e) => e.ts).filter((t): t is string => Boolean(t));
  const firstUser = events.find((e) => e.kind === "text" && e.role === "user" && Boolean(e.text?.trim()));
  const derivedTitle = firstUser?.text ? firstUser.text.split("\n")[0] : undefined;
  return {
    agent: extra.agent ?? "",
    id: ctx.id,
    path: ctx.path,
    mtime: ctx.mtime,
    cwd: extra.cwd,
    gitBranch: extra.gitBranch,
    version: extra.version,
    title: extra.title ?? derivedTitle ?? "(no prompt)",
    messages: events.length,
    started: tss[0],
    ended: tss[tss.length - 1],
    model: models[0],
    models,
    events,
  };
}

/** Configuration for {@link fileAdapter}. */
export interface FileAdapterConfig {
  /** The agent id these sessions belong to. */
  agent: string;
  /** Native root dir holding the transcripts (a leading ~ is expanded). */
  root: string;
  /** What one session is on disk: a matched file (default) or an immediate
   *  subdirectory of the root. */
  unit?: "file" | "dir";
  /** unit:"file" → which files are transcripts (REQUIRED). unit:"dir" → optional
   *  filter on subdirectory names. */
  match?: (name: string) => boolean;
  /** Read mode A — map one transcript's raw JSONL records into a Session
   *  (unit:"file" only). */
  parse?: (lines: Record<string, unknown>[], ctx: FileParseCtx) => Session;
  /** Read mode B — map one whole-file JSON value into a Session (unit:"file" only). */
  parseJson?: (data: unknown, ctx: FileParseCtx) => Session;
  /** Read mode C — full control: turn a unit path (file or dir) into a Session.
   *  Use for dir-per-task, event streams, or any custom read. */
  read?: (path: string, ctx: FileParseCtx) => Session | Promise<Session>;
  /** Export base for relative paths (default: the parent of `root`). */
  base?: string;
  /** A second native root whose sessions are tagged `archived: true`. */
  archivedRoot?: string;
  /** Files to include on export. Default: `match` for unit:"file", all files for
   *  unit:"dir". */
  transferMatch?: (name: string) => boolean;
  /** Also scan agtail's import store (synced-in histories). Default true. */
  importStore?: boolean;
  /** Drop sessions with no real conversation (empty stubs). Default true. */
  skipEmpty?: boolean;
}

export function fileAdapter(cfg: FileAdapterConfig): Adapter {
  const unit = cfg.unit ?? "file";
  const readFn = cfg.read;
  const parseJsonFn = cfg.parseJson;
  const parseFn = cfg.parse;
  const modeCount = [parseFn, parseJsonFn, readFn].filter(Boolean).length;
  // Fail loud at construction (registration time) on a misconfigured adapter.
  if (modeCount !== 1) throw new Error("fileAdapter: provide exactly one of parse / parseJson / read");
  if (unit === "file" && cfg.match === undefined)
    throw new Error('fileAdapter: `match` is required when unit is "file"');
  if (unit === "dir" && (parseFn || parseJsonFn)) {
    throw new Error('fileAdapter: parse/parseJson need unit "file"; use `read` for unit "dir"');
  }

  const root = expandHome(cfg.root);
  const archivedRoot = cfg.archivedRoot === undefined ? undefined : expandHome(cfg.archivedRoot);
  const importStore = cfg.importStore ?? true;
  const skipEmpty = cfg.skipEmpty ?? true;
  const nativeRoots = archivedRoot === undefined ? [root] : [root, archivedRoot];
  const isArchived = (p: string) =>
    archivedRoot !== undefined && (p === archivedRoot || p.startsWith(archivedRoot + sep));
  const match = cfg.match;
  const transferMatch = cfg.transferMatch ?? (unit === "file" ? match : undefined) ?? (() => true);
  const idOf = (p: string) => (unit === "dir" ? basename(p) : basename(p).replace(/\.[^./]+$/, ""));

  const produce = async (path: string, ctx: FileParseCtx): Promise<Session> => {
    if (readFn) return readFn(path, ctx);
    if (parseJsonFn) return parseJsonFn(JSON.parse(await readFile(path, "utf-8")), ctx);
    if (parseFn) {
      const { lines, malformed, truncated } = await collectJsonl(path);
      const sess = parseFn(lines, ctx);
      tagIntegrity(sess, { malformed, truncated });
      return sess;
    }
    throw new Error("fileAdapter: no read mode"); // unreachable (validated above)
  };

  const read = async (path: string): Promise<Session> => {
    const sess = await produce(path, { id: idOf(path), path, mtime: await mtimeMs(path) });
    if (!sess.agent) sess.agent = cfg.agent; // let parse/buildSession omit `agent`
    if (isArchived(path)) sess.archived = true;
    if (importStore) {
      const col = collectionOf(path);
      if (col) {
        sess.imported = true;
        sess.importedFrom = col;
      }
    }
    return sess;
  };

  const discover = async (dir: string): Promise<string[]> => {
    if (unit === "file") return walkFiles(dir, match ?? (() => false));
    // unit:"dir" — immediate subdirectories of `dir`, optional name filter.
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && (match ? match(e.name) : true)).map((e) => join(dir, e.name));
    } catch {
      return []; // missing dir
    }
  };

  const scan = async (dir: string): Promise<SessionMeta[]> => {
    const units = await discover(dir);
    const metas = await Promise.all(
      units.map(async (u) => {
        const sess = await read(u);
        if (skipEmpty && !hasContent(sess.events)) return null; // skip empty stub sessions
        const { events, ...meta } = sess;
        void events;
        return meta;
      }),
    );
    return metas.filter((m): m is SessionMeta => m !== null);
  };

  return {
    agent: cfg.agent,
    base: cfg.base === undefined ? dirname(root) : expandHome(cfg.base),
    roots: () => nativeRoots,
    async findSessions(): Promise<SessionMeta[]> {
      const imported = importStore ? listCollections().map((c) => collectionDir(c, cfg.agent)) : [];
      const lists = await Promise.all([...nativeRoots, ...imported].map(scan));
      return lists.flat();
    },
    transferFiles: async (): Promise<string[]> => {
      const lists = await Promise.all(nativeRoots.map((d) => walkFiles(d, transferMatch)));
      return lists.flat();
    },
    readSession: read,
  };
}
