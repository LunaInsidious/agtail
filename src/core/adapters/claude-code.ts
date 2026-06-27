import { basename } from "node:path";
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

// Claude Code stamps a sentinel like "<synthetic>" on assistant messages it
// fabricates locally (API errors, "[Request interrupted]" notices) rather than
// getting from a real inference. These aren't models: angle-bracketed values
// are dropped so they don't pollute the model list/header or flip cost to
// "unknown" by looking like an unpriced model.
function realModel(v: unknown): string | undefined {
  const s = asString(v);
  return s && !s.startsWith("<") ? s : undefined;
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

/** Script basenames from a hook command (paths use ${CLAUDE_PLUGIN_ROOT}); these
 * identify the actual hook, so we surface them for display + grep. */
function scriptNames(cmd: string): string {
  const scripts = cmd.match(/[^/"\s]+\.(?:py|sh|js|ts|mjs|cjs|rb)/g);
  if (scripts) return [...new Set(scripts)].join(", ");
  return cmd.slice(0, 60);
}

/** Summarize a Stop hook-summary system record (carries hookInfos: command,
 * duration, errors) into a readable, searchable line. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- hook payload summarizer: one branch per hook event shape.
function hookSummary(obj: Record<string, unknown>): string {
  const infos = Array.isArray(obj.hookInfos) ? obj.hookInfos : [];
  const names: string[] = [];
  let totalMs = 0;
  for (const h of infos) {
    const rec = h && typeof h === "object" ? (h as Record<string, unknown>) : {};
    if (typeof rec.durationMs === "number") totalMs += rec.durationMs;
    for (const s of scriptNames(asString(rec.command)).split(", ")) if (s && !names.includes(s)) names.push(s);
  }
  const errs = Array.isArray(obj.hookErrors) ? obj.hookErrors : [];
  const nameStr = names.length ? names.join(", ") : `${infos.length} hook(s)`;
  let text = `Stop · ${nameStr}${totalMs ? ` (${totalMs}ms)` : ""}`;
  if (errs.length) text += ` — ${errs.length} error(s)`;
  return text;
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
function attachmentEvent(obj: Record<string, unknown>, ts: string | undefined, sidechain: boolean): Event {
  const att = obj.attachment && typeof obj.attachment === "object" ? (obj.attachment as Record<string, unknown>) : {};
  const atype = asString(att.type);
  if (HOOK_ATTACH.has(atype)) {
    const hookEvent = asString(att.hookEvent) || "hook";
    const name = asString(att.hookName) || hookEvent;
    const cmd = att.command != null ? ` · ${scriptNames(asString(att.command))}` : "";
    const ms = att.durationMs != null && asString(att.durationMs) !== "" ? ` (${asString(att.durationMs)}ms)` : "";
    let text: string;
    if (atype === "hook_non_blocking_error") {
      const err = asString(att.stderr).split("\n").find(Boolean) || `exit ${asString(att.exitCode)}`;
      text = `✗ ${name}${cmd} — ${err}`;
    } else if (atype === "hook_cancelled") {
      text = `⊘ ${name} cancelled`;
    } else if (atype === "async_hook_response") {
      text = `⤳ async ${name}`;
    } else if (atype === "hook_additional_context") {
      text = `${name} · +context`;
    } else {
      text = `${name}${cmd}${ms}`;
    }
    return { kind: "hook", ts, hookEvent, text, sidechain, raw: obj };
  }
  return { kind: "unknown", ts, text: atype ? `attachment · ${atype}` : "attachment", sidechain, raw: obj };
}

/** Normalize one transcript line into zero or more events. seenUsage dedups
 * per-message usage across the multiple lines Claude emits for one response. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- transcript line normalizer: one branch per message/content shape; keeping the format knowledge in one place is clearer than scattering it.
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
    if (typ === "system" && Array.isArray(obj.hookInfos) && obj.hookInfos.length) {
      // Stop hook summary: hookInfos carries command/duration/errors.
      events.push({ kind: "hook", ts, hookEvent: "Stop", text: hookSummary(obj), sidechain, raw: obj });
    } else if (typ === "system") {
      const txt = asString(obj.content) || asString(obj.subtype);
      events.push({ kind: "system", ts, text: txt, sidechain });
    } else if (typ === "attachment") {
      // Per-event hook firings + other tool affordances live in attachments.
      events.push(attachmentEvent(obj, ts, sidechain));
    } else if (typ !== "user" && typ !== "assistant") {
      // Metadata / attachment / hook / file-history etc. — keep, don't drop.
      events.push({ kind: "unknown", ts, text: typ, sidechain, raw: obj });
    }
    return events;
  }

  const message = msg as Record<string, unknown>;
  const role = asString(message.role) || typ || "?";
  const content = message.content;
  const model = realModel(message.model);
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
      case "thinking": {
        // Recent Claude often persists only a signature, not the reasoning text
        // — skip those empty blocks instead of emitting blank thinking rows.
        const think = asString(blk.thinking);
        if (think.trim()) events.push({ kind: "thinking", ts, role, text: think, sidechain });
        break;
      }
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

// eslint-disable-next-line sonarjs/cognitive-complexity -- single-pass session reader: assembles events, usage and subagent links from a heterogeneous log; splitting would fragment the one read.
async function readSession(path: string): Promise<Session> {
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let version: string | undefined;
  const models: string[] = []; // distinct assistant models, first-seen order
  let started: string | undefined;
  let ended: string | undefined;
  let title: string | undefined;
  let entrypoint: string | undefined;
  let sdkPrompt = false; // a user turn submitted programmatically (promptSource "sdk")
  let messages = 0;
  const raw: Event[] = [];
  const seenUsage = new Set<string>();

  for await (const obj of iterJsonl(path)) {
    messages++;
    cwd ??= asString(obj.cwd) || undefined;
    gitBranch ??= asString(obj.gitBranch) || undefined;
    version ??= asString(obj.version) || undefined;
    entrypoint ??= asString(obj.entrypoint) || undefined;
    if (asString(obj.promptSource) === "sdk") sdkPrompt = true;
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
        // A slash-command invocation (e.g. "/stickers") titles by the command
        // name, not its boilerplate. Skip the injected local-command caveat.
        const cmd = t.match(/<command-name>([^<]+)<\/command-name>/);
        if (cmd) {
          title = cmd[1]!.trim();
        } else if (t && !t.startsWith("[") && !t.startsWith("<local-command-caveat>") && !t.includes("tool_result")) {
          title = t.split("\n")[0]!.slice(0, 120);
        }
      }
      if (m.role === "assistant") {
        const mm = realModel(m.model);
        if (mm && !models.includes(mm)) models.push(mm);
      }
    }
    for (const e of normalizeLine(obj, seenUsage)) raw.push(e);
  }

  const events = mergeToolResults(raw);
  // Machine-driven sessions: launched via the Agent SDK (entrypoint "sdk-cli"/
  // "sdk-py"/…), carrying a programmatically-submitted turn (promptSource
  // "sdk"), or run by the desktop app's background jobs (entrypoint
  // "claude-desktop" — memory/summarisation tasks, never interactive typing;
  // interactive coding is entrypoint "cli"). promptSource alone is unreliable:
  // older versions don't stamp "typed" even on real human turns.
  const programmatic =
    (entrypoint != null && (entrypoint.startsWith("sdk") || entrypoint === "claude-desktop")) || sdkPrompt;
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
    model: models[0],
    models,
    started,
    ended,
    title: subTitle ?? title ?? "(no prompt)",
    messages,
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
