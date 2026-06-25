import { basename, dirname, join, sep } from "node:path";
import type { Adapter } from "./types.js";
import type { Event, Session, SessionMeta, Usage } from "../types.js";
import { iterJsonl } from "../jsonl.js";
import { hasContent } from "../format.js";
import { expandHome, mtimeMs, walkFiles } from "../walk.js";

// OpenAI Codex CLI (v0.14x) stores one rollout JSONL per thread under
// ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl. A sibling SQLite DB
// indexes them, but the files are glob-discoverable, so we read them directly.
//
// Each line is { timestamp, type, payload }. Clean conversation text comes from
// the `event_msg` stream (user_message / agent_message / agent_reasoning),
// while tool calls come from the `response_item` stream (function_call /
// function_call_output, joined by call_id). We skip response_item `message`
// (it duplicates event_msg and carries system-prompt noise) and `reasoning`
// (encrypted). Streaming *_delta events are skipped; anything else is surfaced
// as `unknown` so nothing is silently dropped.

const DEFAULT_ROOT = "~/.codex/sessions";

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function joinCommand(cmd: unknown): string {
  if (Array.isArray(cmd)) return cmd.map((c) => String(c)).join(" ");
  return asString(cmd);
}

/** Map Codex token usage (cached is a subset of input) to agtail Usage. */
function usageFrom(info: unknown): Usage | undefined {
  const last = asRecord(asRecord(info).last_token_usage);
  if (Object.keys(last).length === 0) return undefined;
  const n = (k: string) => (typeof last[k] === "number" ? (last[k] as number) : 0);
  const cached = n("cached_input_tokens");
  return {
    inputTokens: Math.max(0, n("input_tokens") - cached),
    cacheReadTokens: cached,
    outputTokens: n("output_tokens"),
  };
}

interface Parsed {
  events: Event[];
  id?: string;
  cwd?: string;
  version?: string;
  model?: string;
  started?: string;
  ended?: string;
  title?: string;
}

async function parse(path: string): Promise<Parsed> {
  const events: Event[] = [];
  const pending = new Map<string, Event>(); // call_id -> tool_use awaiting result
  let lastAssistant: Event | undefined;
  const out: Parsed = { events };

  for await (const obj of iterJsonl(path)) {
    const ts = asString(obj.timestamp) || undefined;
    if (ts) {
      out.started ??= ts;
      out.ended = ts;
    }
    const type = asString(obj.type);
    const p = asRecord(obj.payload);

    if (type === "session_meta") {
      out.id ??= asString(p.session_id) || asString(p.id) || undefined;
      out.cwd ??= asString(p.cwd) || undefined;
      out.version ??= asString(p.cli_version) || undefined;
      continue;
    }
    if (type === "turn_context") {
      out.model ??= asString(p.model) || undefined;
      continue;
    }

    // Tool calls live in the response_item stream as function_call /
    // function_call_output (the OpenAI Responses shape), joined by call_id.
    if (type === "response_item") {
      const sub = asString(p.type);
      if (sub === "function_call" || sub === "local_shell_call" || sub === "custom_tool_call") {
        const args = parseArgs(p.arguments) ?? asRecord(p.action);
        const rawName = asString(p.name) || sub;
        const tool = rawName === "exec_command" || rawName === "shell" || sub === "local_shell_call" ? "exec" : rawName;
        const callId = asString(p.call_id) || asString(p.id);
        pending.set(callId, pushTool(events, ts, tool, normalizeToolInput(args)));
      } else if (sub === "function_call_output" || sub === "custom_tool_call_output") {
        const callId = asString(p.call_id);
        const text = outputText(p.output);
        const m = text.match(/exited with code (\d+)/);
        const isError = m ? m[1] !== "0" : false;
        const tu = pending.get(callId);
        if (tu) tu.result = { isError, text };
        else events.push({ kind: "tool_result", ts, result: { isError, text } });
      } else if (sub && sub !== "message" && sub !== "reasoning") {
        // message duplicates event_msg; reasoning is encrypted. Surface the rest.
        events.push({ kind: "unknown", ts, text: sub, raw: obj });
      }
      continue;
    }

    if (type !== "event_msg") continue;

    const sub = asString(p.type);
    switch (sub) {
      case "user_message": {
        const text = asString(p.message);
        if (text.trim()) {
          out.title ??= text.split("\n")[0]!.slice(0, 120);
          events.push({ kind: "text", ts, role: "user", text });
        }
        break;
      }
      case "agent_message": {
        const ev: Event = { kind: "text", ts, role: "assistant", text: asString(p.message) };
        events.push(ev);
        lastAssistant = ev;
        break;
      }
      case "agent_reasoning":
      case "agent_reasoning_raw_content": {
        const text = asString(p.text) || asString(p.reasoning);
        if (text.trim()) events.push({ kind: "thinking", ts, role: "assistant", text });
        break;
      }
      case "token_count": {
        const usage = usageFrom(p.info);
        if (usage && lastAssistant) {
          lastAssistant.usage = usage;
          lastAssistant.model = out.model;
        }
        break;
      }
      default:
        // Ignore streaming deltas and turn bookkeeping; preserve anything else.
        if (sub.endsWith("_delta") || sub === "task_started" || sub === "task_complete") break;
        events.push({ kind: "unknown", ts, text: sub, raw: obj });
    }
  }
  return out;
}

function parseArgs(s: unknown): Record<string, unknown> | null {
  if (typeof s !== "string") return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { raw: s };
  }
}

/** Normalize tool args so summaries show the command (Codex uses cmd/workdir). */
function normalizeToolInput(args: Record<string, unknown>): Record<string, unknown> {
  const a = { ...args };
  if (a.cmd != null && a.command == null) a.command = joinCommand(a.cmd);
  if (a.workdir != null && a.cwd == null) a.cwd = a.workdir;
  return a;
}

function outputText(out: unknown): string {
  if (typeof out === "string") return out;
  const o = asRecord(out);
  if (typeof o.content === "string") return o.content;
  if (typeof o.output === "string") return o.output;
  return out == null ? "" : JSON.stringify(out);
}

function pushTool(events: Event[], ts: string | undefined, tool: string, input: unknown): Event {
  const ev: Event = { kind: "tool_use", ts, role: "assistant", tool, input };
  events.push(ev);
  return ev;
}

async function readSession(path: string): Promise<Session> {
  const parsed = await parse(path);
  return {
    agent: "codex",
    id: parsed.id ?? basename(path).replace(/\.jsonl$/, ""),
    path,
    cwd: parsed.cwd,
    version: parsed.version,
    model: parsed.model,
    started: parsed.started,
    ended: parsed.ended,
    title: parsed.title ?? "(no prompt)",
    messages: parsed.events.length,
    mtime: await mtimeMs(path),
    events: parsed.events,
  };
}

export function codexAdapter(rootOverride?: string): Adapter {
  const root = expandHome(rootOverride ?? DEFAULT_ROOT);
  // Codex moves finished threads to a sibling archived_sessions/ (same YYYY/MM/DD
  // tree, files unchanged). We read both roots; only the source dir distinguishes
  // them, so we tag by path prefix — that also covers reads via resolveSession.
  const archivedRoot = join(dirname(root), "archived_sessions");
  const isArchived = (p: string) => p === archivedRoot || p.startsWith(archivedRoot + sep);

  const read = async (path: string): Promise<Session> => {
    const sess = await readSession(path);
    if (isArchived(path)) sess.archived = true;
    return sess;
  };

  const scan = async (dir: string): Promise<SessionMeta[]> => {
    const paths = await walkFiles(dir, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"));
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
    agent: "codex",
    roots: () => [root, archivedRoot],
    async findSessions(): Promise<SessionMeta[]> {
      const [active, archived] = await Promise.all([scan(root), scan(archivedRoot)]);
      return [...active, ...archived];
    },
    readSession: read,
  };
}
