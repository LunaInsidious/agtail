import { basename, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type { Adapter } from "./types.js";
import type { Event, Session, SessionMeta, Usage } from "../types.js";
import { iterJsonl } from "../jsonl.js";
import { hasContent } from "../format.js";
import { expandHome, mtimeMs, walkFiles } from "../walk.js";
import { isRecord, obj, str } from "../utils.js";
import { collectionDir, collectionOf, listCollections } from "../imported.js";
import { firstLine } from "./utils.js";

// Claude Code stores one JSONL transcript per session under
// ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl (plus subagents/).
// Schema is large (50+ record types) and version-dependent; we map the core
// conversation precisely and surface everything else as `unknown` (never drop).

const DEFAULT_ROOT = "~/.claude/projects";
const AGENT = "claude-code";

// Claude Code stamps a sentinel like "<synthetic>" on assistant messages it
// fabricates locally (API errors, "[Request interrupted]" notices) rather than
// getting from a real inference. These aren't models: angle-bracketed values
// are dropped so they don't pollute the model list/header or flip cost to
// "unknown" by looking like an unpriced model.
function realModel(v: unknown): string | undefined {
  const s = str(v);
  return s && !s.startsWith("<") ? s : undefined;
}

/** Concatenate text from a content value (string or block array). */
function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content) {
    if (typeof b === "string") parts.push(b);
    else if (isRecord(b)) {
      if (b.type === "text") parts.push(str(b.text));
      else if (b.type === "tool_result") parts.push(textFromContent(b.content));
    }
  }
  return parts.filter(Boolean).join("\n");
}

function usageFrom(u: unknown): Usage | undefined {
  if (!isRecord(u)) return undefined;
  const n = (k: string) => {
    const v = u[k];
    return typeof v === "number" ? v : undefined;
  };
  const usage: Usage = {
    inputTokens: n("input_tokens"),
    outputTokens: n("output_tokens"),
    cacheReadTokens: n("cache_read_input_tokens"),
    cacheCreationTokens: n("cache_creation_input_tokens"),
  };
  return usage;
}

/** Script basenames from a hook command (paths use ${CLAUDE_PLUGIN_ROOT}); these
 * identify the actual hook, so we surface them for display + grep. */
function scriptNames(cmd: string): string {
  const scripts = cmd.match(/[^/"\s]+\.(?:py|sh|js|ts|mjs|cjs|rb)/g);
  if (scripts) return [...new Set(scripts)].join(", ");
  return cmd.slice(0, 60);
}

/** Summarize a Stop hook-summary system record (carries hookInfos: command,
 * duration, errors) into a readable, searchable line. */
function hookSummary(line: Record<string, unknown>): string {
  const infos = (Array.isArray(line.hookInfos) ? line.hookInfos : []).map(obj);
  const totalMs = infos.reduce((sum, h) => sum + (typeof h.durationMs === "number" ? h.durationMs : 0), 0);
  const names = [...new Set(infos.flatMap((h) => scriptNames(str(h.command)).split(", ")).filter(Boolean))];
  const errs = Array.isArray(line.hookErrors) ? line.hookErrors : [];
  const nameStr = names.length ? names.join(", ") : `${infos.length} hook(s)`;
  const base = `Stop · ${nameStr}${totalMs ? ` (${totalMs}ms)` : ""}`;
  return errs.length ? `${base} — ${errs.length} error(s)` : base;
}

// Attachment subtypes that record a hook firing (the per-event detail Claude
// stores outside the Stop summary). Mapped to first-class `hook` events.
const HOOK_ATTACH = new Set([
  "hook_success",
  "hook_non_blocking_error",
  "async_hook_response",
  "hook_additional_context",
  "hook_cancelled",
]);

/** Turn an `attachment` record into an event: a `hook` event for hook attachments
 * (grouped by hookEvent), else an `unknown` labelled with its subtype. */
function attachmentEvent(line: Record<string, unknown>, ts: string | undefined, sidechain: boolean): Event {
  const att = obj(line.attachment);
  const atype = str(att.type);
  if (HOOK_ATTACH.has(atype)) {
    const hookEvent = str(att.hookEvent) || "hook";
    // The configured-hook label: the matcher part of "Event:matcher" (e.g.
    // "Bash", "startup"). The lifecycle event is surfaced separately as hookEvent,
    // and the concrete triggering tool via toolUseId, so the text stays short.
    const matcher = str(att.hookName).split(":").slice(1).join(":");
    const scripts = att.command != null ? scriptNames(str(att.command)) : "";
    const ms = att.durationMs != null && str(att.durationMs) !== "" ? ` (${str(att.durationMs)}ms)` : "";
    return {
      kind: "hook",
      ts,
      hookEvent,
      // PreToolUse/PostToolUse carry the id of the tool_use that triggered them;
      // resolved to the tool name in readSession (see withHookTools).
      toolUseId: str(att.toolUseID) || undefined,
      // The full command, kept so the display layer can resolve which plugin it
      // belongs to (core/plugins.ts).
      command: str(att.command) || undefined,
      text: hookText(atype, { label: scripts || matcher, ms, att }),
      sidechain,
      raw: line,
    };
  }
  return { kind: "unknown", ts, text: atype ? `attachment · ${atype}` : "attachment", sidechain, raw: line };
}

/** The display line for a hook attachment, keyed by its subtype. `label` is the
 *  hook's script (preferred) or its matcher. */
function hookText(atype: string, p: { label: string; ms: string; att: Record<string, unknown> }): string {
  const { label, ms, att } = p;
  if (atype === "hook_non_blocking_error") {
    const err = str(att.stderr).split("\n").find(Boolean) || `exit ${str(att.exitCode)}`;
    return `✗ ${label} — ${err}`;
  }
  if (atype === "hook_cancelled") return `⊘ ${label} cancelled`;
  if (atype === "async_hook_response") return `⤳ async ${label}`;
  if (atype === "hook_additional_context") {
    // The point of this kind is the text it injected back into the session, so
    // show that rather than the (command-less) matcher.
    const ctx = firstLine(textFromContent(att.content));
    return ctx ? `+context · ${ctx}` : `${label} · +context`;
  }
  return `${label}${ms}`;
}

/** Normalize one transcript line into zero or more events. seenUsage dedups
 * per-message usage across the multiple lines Claude emits for one response. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- transcript line normalizer: one branch per message/content shape; keeping the format knowledge in one place is clearer than scattering it.
function normalizeLine(line: Record<string, unknown>, seenUsage: Set<string>): Event[] {
  const typ = str(line.type);
  const ts = str(line.timestamp) || undefined;
  const sidechain = Boolean(line.isSidechain);

  if (typ === "summary") return [{ kind: "summary", ts, text: str(line.summary) }];

  const msg = line.message;
  if (!isRecord(msg)) return metaEvents(line, typ, ts, sidechain);

  const role = str(msg.role) || typ || "?";
  const content = msg.content;
  const model = realModel(msg.model);
  const msgId = str(msg.id);
  const rawUsage = usageFrom(msg.usage);

  // Claude writes one API response as several lines (one per content block),
  // each repeating the SAME usage. Attach it once per message id so token/cost
  // isn't multiplied by the number of blocks. `attached` is the one bit of
  // running state (a const flag object, mutated in place — not a `let`).
  const attached = { done: false };
  const attachUsage = (): { model?: string; usage?: Usage } => {
    if (attached.done || !rawUsage) return {};
    attached.done = true;
    if (msgId) {
      if (seenUsage.has(msgId)) return {};
      seenUsage.add(msgId);
    }
    return { model, usage: rawUsage };
  };

  if (typeof content === "string") {
    return content.trim() ? [{ kind: "text", ts, role, text: content, sidechain, ...attachUsage() }] : [];
  }
  if (!Array.isArray(content)) return [];

  return content.flatMap((b): Event[] => {
    if (!isRecord(b)) return [];
    return blockEvent(b, { ts, role, sidechain, attachUsage });
  });
}

/** Records with no `message` body: summary lines, system text, attachments, and
 *  other metadata kinds (kept as `unknown`, never dropped). */
function metaEvents(line: Record<string, unknown>, typ: string, ts: string | undefined, sidechain: boolean): Event[] {
  if (typ === "system" && Array.isArray(line.hookInfos) && line.hookInfos.length) {
    // Stop hook summary: hookInfos carries command/duration/errors.
    return [{ kind: "hook", ts, hookEvent: "Stop", text: hookSummary(line), sidechain, raw: line }];
  }
  if (typ === "system") return [{ kind: "system", ts, text: str(line.content) || str(line.subtype), sidechain }];
  // Per-event hook firings + other tool affordances live in attachments.
  if (typ === "attachment") return [attachmentEvent(line, ts, sidechain)];
  // Metadata / hook / file-history etc. — keep, don't drop.
  if (typ !== "user" && typ !== "assistant") return [{ kind: "unknown", ts, text: typ, sidechain, raw: line }];
  return [];
}

interface BlockCtx {
  ts: string | undefined;
  role: string;
  sidechain: boolean;
  attachUsage: () => { model?: string; usage?: Usage };
}

/** Map one content block to its event(s). */
function blockEvent(blk: Record<string, unknown>, c: BlockCtx): Event[] {
  const { ts, role, sidechain, attachUsage } = c;
  switch (blk.type) {
    case "text":
      return str(blk.text).trim() ? [{ kind: "text", ts, role, text: str(blk.text), sidechain, ...attachUsage() }] : [];
    case "thinking": {
      // Recent Claude often persists only a signature, not the reasoning text
      // — skip those empty blocks instead of emitting blank thinking rows.
      const think = str(blk.thinking);
      return think.trim() ? [{ kind: "thinking", ts, role, text: think, sidechain }] : [];
    }
    case "tool_use":
      return [
        {
          kind: "tool_use",
          ts,
          role,
          sidechain,
          tool: str(blk.name),
          toolUseId: str(blk.id),
          input: blk.input ?? {},
          ...attachUsage(),
        },
      ];
    case "tool_result":
      return [
        {
          kind: "tool_result",
          ts,
          role,
          sidechain,
          toolUseId: str(blk.tool_use_id),
          result: { isError: Boolean(blk.is_error), text: textFromContent(blk.content) },
        },
      ];
    default:
      return [];
  }
}

/** Merge tool_result events into their originating tool_use by id. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- pairs each tool_use with its tool_result across the flat event stream.
function mergeToolResults(events: Event[]): Event[] {
  const results = new Map<string, Event>();
  for (const e of events) {
    if (e.kind === "tool_result" && e.toolUseId) results.set(e.toolUseId, e);
  }
  const merged: Event[] = [];
  for (const e of events) {
    if (e.kind === "tool_result" && e.toolUseId && results.has(e.toolUseId)) continue;
    if (e.kind === "tool_use" && e.toolUseId) {
      const r = results.get(e.toolUseId);
      if (r?.result) merged.push({ ...e, result: r.result });
      else merged.push(e);
    } else {
      merged.push(e);
    }
  }
  return merged;
}

/** Resolve each tool-triggered hook to the tool that fired it: PreToolUse/
 *  PostToolUse carry the triggering tool_use's id, so look up its tool name (the
 *  matcher in hookName can be a glob like "*", so the concrete tool is better). */
function withHookTools(events: Event[]): Event[] {
  const toolById = new Map<string, string>();
  for (const e of events) if (e.kind === "tool_use" && e.toolUseId && e.tool) toolById.set(e.toolUseId, e.tool);
  return events.map((e) =>
    e.kind === "hook" && e.toolUseId && !e.tool ? { ...e, tool: toolById.get(e.toolUseId) } : e,
  );
}

// A subagent transcript lives under <parentId>/subagents/ with a sibling
// agent-<id>.meta.json describing the spawning Task call. Task subagents sit
// directly in subagents/; Workflow ones nest deeper (subagents/workflows/wf_*/).
const SUBAGENT_RE = /[/\\]subagents[/\\].*\.jsonl$/;

interface SubagentInfo {
  parentId: string;
  agentName?: string;
  description?: string;
  toolUseId?: string;
}

function readSubagentInfo(path: string): SubagentInfo {
  // Parent is the dir just above subagents/, whatever the nesting under it
  // (subagents/agent-*.jsonl or subagents/workflows/wf_*/agent-*.jsonl).
  const parentId = basename(path.replace(/[/\\]subagents[/\\].*$/, ""));
  const info: SubagentInfo = { parentId };
  const metaPath = path.replace(/\.jsonl$/, ".meta.json");
  // Optional enrichment; tolerate a missing/corrupt meta the same way iterJsonl
  // tolerates broken lines (tool-owned data, may vary by version).
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      info.agentName = meta.agentType;
      info.description = meta.description;
      info.toolUseId = meta.toolUseId;
    } catch {
      /* leave fields undefined */
    }
  }
  return info;
}

/** A title derived from a user message: the slash-command name if present, else
 *  the first line — skipping injected boilerplate (caveats / tool_result). The
 *  boilerplate markers are checked on the FIRST LINE only: a real prompt whose
 *  body happens to contain "tool_result" (e.g. a diff under review) must still be
 *  titled by its opening line, not discarded. */
function titleFromUser(msg: Record<string, unknown>): string | undefined {
  const t = textFromContent(msg.content).trim();
  // A slash-command invocation (e.g. "/stickers") titles by the command name.
  const cmd = t.match(/<command-name>([^<]+)<\/command-name>/);
  if (cmd?.[1] != null) return cmd[1].trim();
  const head = firstLine(t);
  if (head && !head.startsWith("[") && !head.startsWith("<local-command-caveat>") && !head.includes("tool_result")) {
    return head;
  }
  return undefined;
}

// Sequential metadata accumulated while streaming the transcript. First-write-
// wins fields use ??= ; `ended`/`models`/`messages` keep updating (O(n), one
// const cursor object — mirrors the codex `meta` accumulator).
interface Meta {
  cwd?: string;
  gitBranch?: string;
  version?: string;
  started?: string;
  ended?: string;
  title?: string;
  entrypoint?: string;
  sdkPrompt: boolean;
  messages: number;
  models: string[];
}

function accumulate(meta: Meta, line: Record<string, unknown>): void {
  meta.messages++;
  meta.cwd ??= str(line.cwd) || undefined;
  meta.gitBranch ??= str(line.gitBranch) || undefined;
  meta.version ??= str(line.version) || undefined;
  meta.entrypoint ??= str(line.entrypoint) || undefined;
  if (str(line.promptSource) === "sdk") meta.sdkPrompt = true;
  const ts = str(line.timestamp) || undefined;
  if (ts) {
    meta.started ??= ts;
    meta.ended = ts;
  }
  const msg = line.message;
  if (!isRecord(msg)) return;
  if (meta.title === undefined && msg.role === "user") meta.title ??= titleFromUser(msg);
  if (msg.role === "assistant") {
    const mm = realModel(msg.model);
    if (mm && !meta.models.includes(mm)) meta.models.push(mm);
  }
}

async function readSession(path: string): Promise<Session> {
  const meta: Meta = { sdkPrompt: false, messages: 0, models: [] };
  const raw: Event[] = [];
  const seenUsage = new Set<string>();

  for await (const line of iterJsonl(path)) {
    accumulate(meta, line);
    for (const e of normalizeLine(line, seenUsage)) raw.push(e);
  }

  const events = withHookTools(mergeToolResults(raw));
  const { entrypoint, models } = meta;
  // Machine-driven sessions: launched via the Agent SDK (entrypoint "sdk-cli"/
  // "sdk-py"/…), carrying a programmatically-submitted turn (promptSource
  // "sdk"), or run by the desktop app's background jobs (entrypoint
  // "claude-desktop" — memory/summarisation tasks, never interactive typing;
  // interactive coding is entrypoint "cli"). promptSource alone is unreliable:
  // older versions don't stamp "typed" even on real human turns.
  const programmatic =
    (entrypoint != null && (entrypoint.startsWith("sdk") || entrypoint === "claude-desktop")) || meta.sdkPrompt;
  const isSubagent = SUBAGENT_RE.test(path);
  const sub = isSubagent ? readSubagentInfo(path) : undefined;
  // For a subagent, the task description is a clearer title than the raw
  // instruction prompt. The agent type is shown separately as a badge.
  const subTitle = sub?.description || undefined;
  // No human prompt but real content (e.g. a resumed/forked session): fall back
  // to the first message rather than an opaque "(no prompt)".
  const fallbackText = events.find((e) => e.kind === "text" && e.text?.trim())?.text?.trim();
  const title = meta.title ?? (fallbackText ? firstLine(fallbackText) : undefined);

  return {
    agent: AGENT,
    id: basename(path).replace(/\.jsonl$/, ""),
    path,
    cwd: meta.cwd,
    gitBranch: meta.gitBranch,
    version: meta.version,
    model: models[0],
    models,
    started: meta.started,
    ended: meta.ended,
    title: subTitle ?? title ?? "(no prompt)",
    messages: meta.messages,
    mtime: await mtimeMs(path),
    events,
    ...(programmatic ? { programmatic: true, origin: entrypoint } : {}),
    ...(isSubagent && sub
      ? {
          isSubagent: true,
          parentId: sub.parentId,
          agentName: sub.agentName,
          spawnedByToolUseId: sub.toolUseId,
        }
      : {}),
  };
}

const JSONL = ".jsonl";
const isJsonl = (n: string) => n.endsWith(JSONL);
// Both transcripts AND their sibling subagent metas are part of a session's
// on-disk footprint, so export carries both.
const isTransfer = (n: string) => n.endsWith(JSONL) || n.endsWith(".meta.json");

export function claudeCodeAdapter(rootOverride?: string): Adapter {
  const root = expandHome(rootOverride ?? DEFAULT_ROOT);
  // The agtail import store mirrors the native projects/ layout, read lazily so
  // a relocated XDG_DATA_HOME (tests) is picked up. A session found under it is
  // tagged imported + the collection (first path segment) it came from.
  const read = async (path: string): Promise<Session> => {
    const sess = await readSession(path);
    const col = collectionOf(path);
    if (col) {
      sess.imported = true;
      sess.importedFrom = col;
    }
    return sess;
  };

  const scan = async (dir: string): Promise<SessionMeta[]> => {
    const paths = await walkFiles(dir, isJsonl);
    const metas = await Promise.all(
      paths.map(async (p) => {
        const sess = await read(p);
        if (!hasContent(sess.events)) return null; // skip empty stub sessions
        const { events, ...meta } = sess;
        void events;
        return meta;
      }),
    );
    return metas.filter((m): m is SessionMeta => m !== null);
  };

  return {
    agent: AGENT,
    base: dirname(root),
    roots: () => [root],
    async findSessions(): Promise<SessionMeta[]> {
      const imported = listCollections().map((c) => scan(collectionDir(c, AGENT)));
      const lists = await Promise.all([scan(root), ...imported]);
      return lists.flat();
    },
    transferFiles: () => walkFiles(root, isTransfer),
    readSession: read,
  };
}
