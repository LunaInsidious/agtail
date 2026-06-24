import { basename, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type { Adapter } from "./types.js";
import type { Event, Session, SessionMeta, Usage } from "../types.js";
import { iterJsonl } from "../jsonl.js";
import { hasContent } from "../format.js";
import { expandHome, mtimeMs, walkFiles } from "../walk.js";

// Claude Code stores one JSONL transcript per session under
// ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl (plus subagents/).
// Schema is large (50+ record types) and version-dependent; we map the core
// conversation precisely and surface everything else as `unknown` (never drop).

const DEFAULT_ROOT = "~/.claude/projects";

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Concatenate text from a content value (string or block array). */
function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content) {
    if (typeof b === "string") parts.push(b);
    else if (b && typeof b === "object") {
      const blk = b as Record<string, unknown>;
      if (blk.type === "text") parts.push(asString(blk.text));
      else if (blk.type === "tool_result") parts.push(textFromContent(blk.content));
    }
  }
  return parts.filter(Boolean).join("\n");
}

function usageFrom(u: unknown): Usage | undefined {
  if (!u || typeof u !== "object") return undefined;
  const o = u as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" ? (o[k] as number) : undefined);
  const usage: Usage = {
    inputTokens: n("input_tokens"),
    outputTokens: n("output_tokens"),
    cacheReadTokens: n("cache_read_input_tokens"),
    cacheCreationTokens: n("cache_creation_input_tokens"),
  };
  return usage;
}

/** Normalize one transcript line into zero or more events. seenUsage dedups
 * per-message usage across the multiple lines Claude emits for one response. */
function normalizeLine(obj: Record<string, unknown>, seenUsage: Set<string>): Event[] {
  const events: Event[] = [];
  const typ = asString(obj.type);
  const ts = asString(obj.timestamp) || undefined;
  const sidechain = Boolean(obj.isSidechain);

  if (typ === "summary") {
    events.push({ kind: "summary", ts, text: asString(obj.summary) });
    return events;
  }

  const msg = obj.message;
  if (!msg || typeof msg !== "object") {
    if (typ === "system") {
      const txt = asString(obj.content) || asString(obj.subtype);
      events.push({ kind: "system", ts, text: txt, sidechain });
    } else if (typ !== "user" && typ !== "assistant") {
      // Metadata / attachment / hook / file-history etc. — keep, don't drop.
      events.push({ kind: "unknown", ts, text: typ, sidechain, raw: obj });
    }
    return events;
  }

  const message = msg as Record<string, unknown>;
  const role = asString(message.role) || typ || "?";
  const content = message.content;
  const model = asString(message.model) || undefined;
  const msgId = asString(message.id);
  const rawUsage = usageFrom(message.usage);

  // Claude writes one API response as several lines (one per content block),
  // each repeating the SAME usage. Attach it once per message id so token/cost
  // isn't multiplied by the number of blocks.
  let usageAttached = false;
  const attachUsage = (): { model?: string; usage?: Usage } => {
    if (usageAttached || !rawUsage) return {};
    usageAttached = true;
    if (msgId) {
      if (seenUsage.has(msgId)) return {};
      seenUsage.add(msgId);
    }
    return { model, usage: rawUsage };
  };

  if (typeof content === "string") {
    if (content.trim()) events.push({ kind: "text", ts, role, text: content, sidechain, ...attachUsage() });
    return events;
  }
  if (!Array.isArray(content)) return events;

  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    const blk = b as Record<string, unknown>;
    switch (blk.type) {
      case "text":
        if (asString(blk.text).trim())
          events.push({ kind: "text", ts, role, text: asString(blk.text), sidechain, ...attachUsage() });
        break;
      case "thinking":
        events.push({ kind: "thinking", ts, role, text: asString(blk.thinking), sidechain });
        break;
      case "tool_use":
        events.push({
          kind: "tool_use",
          ts,
          role,
          sidechain,
          tool: asString(blk.name),
          toolUseId: asString(blk.id),
          input: blk.input ?? {},
          ...attachUsage(),
        });
        break;
      case "tool_result":
        events.push({
          kind: "tool_result",
          ts,
          role,
          sidechain,
          toolUseId: asString(blk.tool_use_id),
          result: { isError: Boolean(blk.is_error), text: textFromContent(blk.content) },
        });
        break;
      default:
        break;
    }
  }
  return events;
}

/** Merge tool_result events into their originating tool_use by id. */
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

// A subagent transcript lives at <parentId>/subagents/agent-<id>.jsonl with a
// sibling agent-<id>.meta.json describing the spawning Task call.
const SUBAGENT_RE = /[/\\]subagents[/\\][^/\\]+\.jsonl$/;

interface SubagentInfo {
  parentId: string;
  agentName?: string;
  description?: string;
  toolUseId?: string;
}

function readSubagentInfo(path: string): SubagentInfo {
  const parentId = basename(dirname(dirname(path))); // .../<parentId>/subagents/file
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

async function readSession(path: string): Promise<Session> {
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let version: string | undefined;
  let model: string | undefined;
  let started: string | undefined;
  let ended: string | undefined;
  let title: string | undefined;
  let messages = 0;
  const raw: Event[] = [];
  const seenUsage = new Set<string>();

  for await (const obj of iterJsonl(path)) {
    messages++;
    cwd ??= asString(obj.cwd) || undefined;
    gitBranch ??= asString(obj.gitBranch) || undefined;
    version ??= asString(obj.version) || undefined;
    const ts = asString(obj.timestamp) || undefined;
    if (ts) {
      started ??= ts;
      ended = ts;
    }
    const msg = obj.message;
    if (msg && typeof msg === "object") {
      const m = msg as Record<string, unknown>;
      if (title === undefined && m.role === "user") {
        const t = textFromContent(m.content).trim();
        if (t && !t.startsWith("[") && !t.includes("tool_result")) {
          title = t.split("\n")[0]!.slice(0, 120);
        }
      }
      if (model === undefined && m.role === "assistant") model = asString(m.model) || undefined;
    }
    for (const e of normalizeLine(obj, seenUsage)) raw.push(e);
  }

  const events = mergeToolResults(raw);
  const isSubagent = SUBAGENT_RE.test(path);
  const sub = isSubagent ? readSubagentInfo(path) : undefined;
  // For a subagent, the task description is a clearer title than the raw
  // instruction prompt. The agent type is shown separately as a badge.
  const subTitle = sub?.description || undefined;
  // No human prompt but real content (e.g. a resumed/forked session): fall back
  // to the first message rather than an opaque "(no prompt)".
  if (title === undefined) {
    const firstText = events.find((e) => e.kind === "text" && e.text?.trim());
    if (firstText) title = firstText.text!.trim().split("\n")[0]!.slice(0, 120);
  }

  return {
    agent: "claude-code",
    id: basename(path).replace(/\.jsonl$/, ""),
    path,
    cwd,
    gitBranch,
    version,
    model,
    started,
    ended,
    title: subTitle ?? title ?? "(no prompt)",
    messages,
    mtime: await mtimeMs(path),
    events,
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

export function claudeCodeAdapter(rootOverride?: string): Adapter {
  const root = expandHome(rootOverride ?? DEFAULT_ROOT);
  return {
    agent: "claude-code",
    roots: () => [root],
    async findSessions(): Promise<SessionMeta[]> {
      const paths = await walkFiles(root, (n) => n.endsWith(".jsonl"));
      const metas = await Promise.all(
        paths.map(async (p) => {
          const sess = await readSession(p);
          if (!hasContent(sess.events)) return null; // skip empty stub sessions
          const { events, ...meta } = sess;
          void events;
          return meta;
        }),
      );
      return metas.filter((m): m is SessionMeta => m !== null);
    },
    readSession,
  };
}
