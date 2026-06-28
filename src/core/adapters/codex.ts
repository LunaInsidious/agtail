import { basename, dirname, join, sep } from "node:path";
import type { Adapter } from "./types.js";
import type { Event, Session, SessionMeta, Usage } from "../types.js";
import { iterJsonl } from "../jsonl.js";
import { hasContent } from "../format.js";
import { expandHome, mtimeMs, walkFiles } from "../walk.js";
import { collect, isRecord, obj, str } from "../utils.js";
import { importStoreDir } from "../imported.js";
import { firstLine } from "./utils.js";

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

function joinCommand(cmd: unknown): string {
  if (Array.isArray(cmd)) return cmd.map((c) => String(c)).join(" ");
  return str(cmd);
}

/** Map Codex token usage (cached is a subset of input) to agtail Usage. */
function usageFrom(info: unknown): Usage | undefined {
  const last = obj(obj(info).last_token_usage);
  if (Object.keys(last).length === 0) return undefined;
  const n = (k: string): number => {
    const v = last[k];
    return typeof v === "number" ? v : 0;
  };
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
  models?: string[];
  started?: string;
  ended?: string;
  title?: string;
  programmatic?: boolean;
  origin?: string;
}

// Codex rollout parsing in two pure passes: materialize the JSONL lines into
// typed records, then derive the metadata and event list from them — no mutable
// accumulators, no in-place back-patching.

type Rec = { ts?: string; type: string; p: Record<string, unknown>; raw: Record<string, unknown> };

const isMsg = (r: Rec, sub: string): boolean => r.type === "event_msg" && str(r.p.type) === sub;

// Token usage is reported by the token_count line that follows an assistant
// message, carrying the current turn's model. One O(n) forward pass keyed by the
// assistant's record index — the cursor object is the one bit of running state we
// keep, which reads clearer here than a pure per-message lookahead (and stays O(n)).
function usageByIndex(rec: Rec[], fallbackModel?: string): Map<number, { usage: Usage; model?: string }> {
  const byIndex = new Map<number, { usage: Usage; model?: string }>();
  const cursor = { assistantAt: -1, model: fallbackModel };
  rec.forEach((r, i) => {
    if (r.type === "turn_context") cursor.model = str(r.p.model) || cursor.model;
    else if (isMsg(r, "agent_message")) cursor.assistantAt = i;
    else if (isMsg(r, "token_count")) {
      const usage = usageFrom(r.p.info);
      if (usage && cursor.assistantAt >= 0) byIndex.set(cursor.assistantAt, { usage, model: cursor.model });
    }
  });
  return byIndex;
}

function toEvents(
  rec: Rec[],
  outputs: Map<string, { isError: boolean; text: string }>,
  calledIds: Set<string>,
  usageMap: Map<number, { usage: Usage; model?: string }>,
): Event[] {
  // eslint-disable-next-line sonarjs/cognitive-complexity -- one branch per record kind; the branching is breadth over the rollout shapes.
  return rec.flatMap((r, i): Event[] => {
    const { ts, p } = r;
    // Tool calls live in the response_item stream as function_call /
    // function_call_output (the OpenAI Responses shape), joined by call_id.
    if (r.type === "response_item") {
      const sub = str(p.type);
      if (sub === "function_call" || sub === "local_shell_call" || sub === "custom_tool_call") {
        const args = parseArgs(p.arguments) ?? obj(p.action);
        const rawName = str(p.name) || sub;
        const tool = rawName === "exec_command" || rawName === "shell" || sub === "local_shell_call" ? "exec" : rawName;
        const result = outputs.get(str(p.call_id) || str(p.id));
        return [
          {
            kind: "tool_use",
            ts,
            role: "assistant",
            tool,
            input: normalizeToolInput(args),
            ...(result ? { result } : {}),
          },
        ];
      }
      if (sub === "function_call_output" || sub === "custom_tool_call_output") {
        // Matched results fold into their call (above); only orphans get a row.
        const callId = str(p.call_id);
        return calledIds.has(callId) ? [] : [{ kind: "tool_result", ts, result: outputs.get(callId) }];
      }
      // message duplicates event_msg; reasoning is encrypted. Surface the rest.
      return sub && sub !== "message" && sub !== "reasoning" ? [{ kind: "unknown", ts, text: sub, raw: r.raw }] : [];
    }
    if (r.type !== "event_msg") return [];
    const sub = str(p.type);
    switch (sub) {
      case "user_message": {
        const text = str(p.message);
        return text.trim() ? [{ kind: "text", ts, role: "user", text }] : [];
      }
      case "agent_message":
        return [{ kind: "text", ts, role: "assistant", text: str(p.message), ...usageMap.get(i) }];
      case "agent_reasoning":
      case "agent_reasoning_raw_content": {
        const text = str(p.text) || str(p.reasoning);
        return text.trim() ? [{ kind: "thinking", ts, role: "assistant", text }] : [];
      }
      case "token_count":
        return []; // folded into its assistant message via usageByIndex
      default:
        // Ignore streaming deltas and turn bookkeeping; preserve anything else.
        return sub.endsWith("_delta") || sub === "task_started" || sub === "task_complete"
          ? []
          : [{ kind: "unknown", ts, text: sub, raw: r.raw }];
    }
  });
}

async function parse(path: string): Promise<Parsed> {
  const rec: Rec[] = (await collect(iterJsonl(path))).map((line) => ({
    ts: str(line.timestamp) || undefined,
    type: str(line.type),
    p: obj(line.payload),
    raw: line,
  }));

  const tss = rec.map((r) => r.ts).filter((t): t is string => !!t);
  // A resumed/forked rollout records the ORIGINAL conversation in `session_id`
  // but gets its own unique `id`; identify by the rollout's own `id` so a fork
  // doesn't collapse onto — and duplicate — the original's id.
  const meta = rec.find((r) => r.type === "session_meta")?.p ?? {};
  // Interactive Codex runs as the TUI (originator "codex-tui"); anything else
  // (SDK / `codex exec` / scripted) is machine-driven.
  const originator = str(meta.originator);
  const models = [
    ...new Set(
      rec
        .filter((r) => r.type === "turn_context")
        .map((r) => str(r.p.model))
        .filter(Boolean),
    ),
  ];
  const firstUser = rec.find((r) => isMsg(r, "user_message") && str(r.p.message).trim());

  const isOut = (r: Rec) =>
    r.type === "response_item" && ["function_call_output", "custom_tool_call_output"].includes(str(r.p.type));
  const isCall = (r: Rec) =>
    r.type === "response_item" && ["function_call", "local_shell_call", "custom_tool_call"].includes(str(r.p.type));
  const outputs = new Map(
    rec.filter(isOut).map((r) => {
      const text = outputText(r.p.output);
      const m = text.match(/exited with code (\d+)/);
      return [str(r.p.call_id), { isError: m ? m[1] !== "0" : false, text }] as const;
    }),
  );
  const calledIds = new Set(rec.filter(isCall).map((r) => str(r.p.call_id) || str(r.p.id)));

  return {
    events: toEvents(rec, outputs, calledIds, usageByIndex(rec, models[0])),
    models,
    id: str(meta.id) || str(meta.session_id) || undefined,
    cwd: str(meta.cwd) || undefined,
    version: str(meta.cli_version) || undefined,
    model: models[0],
    started: tss[0],
    ended: tss.at(-1),
    title: firstUser ? firstLine(str(firstUser.p.message)) : undefined,
    ...(originator && originator !== "codex-tui" ? { programmatic: true, origin: originator } : {}),
  };
}

function parseArgs(s: unknown): Record<string, unknown> | null {
  if (typeof s !== "string") return null;
  try {
    const v: unknown = JSON.parse(s);
    return isRecord(v) ? v : { value: v };
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
  const o = obj(out);
  if (typeof o.content === "string") return o.content;
  if (typeof o.output === "string") return o.output;
  return out == null ? "" : JSON.stringify(out);
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
    models: parsed.models,
    started: parsed.started,
    ended: parsed.ended,
    title: parsed.title ?? "(no prompt)",
    messages: parsed.events.length,
    mtime: await mtimeMs(path),
    events: parsed.events,
    ...(parsed.programmatic ? { programmatic: true, origin: parsed.origin } : {}),
  };
}

const isRollout = (n: string) => n.startsWith("rollout-") && n.endsWith(".jsonl");

export function codexAdapter(rootOverride?: string): Adapter {
  const root = expandHome(rootOverride ?? DEFAULT_ROOT);
  // Codex moves finished threads to a sibling archived_sessions/ (same YYYY/MM/DD
  // tree, files unchanged). We read both roots; only the source dir distinguishes
  // them, so we tag by path prefix — that also covers reads via resolveSession.
  const archivedRoot = join(dirname(root), "archived_sessions");
  const isArchived = (p: string) => p === archivedRoot || p.startsWith(archivedRoot + sep);
  // The agtail import store mirrors the native layout; sessions found under it
  // are tagged imported by path prefix, same mechanism as archived.
  const isImported = (p: string) => {
    const store = importStoreDir("codex");
    return p === store || p.startsWith(store + sep);
  };

  const read = async (path: string): Promise<Session> => {
    const sess = await readSession(path);
    if (isArchived(path)) sess.archived = true;
    if (isImported(path)) sess.imported = true;
    return sess;
  };

  const scan = async (dir: string): Promise<SessionMeta[]> => {
    const paths = await walkFiles(dir, isRollout);
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
    base: dirname(root),
    roots: () => [root, archivedRoot],
    async findSessions(): Promise<SessionMeta[]> {
      const [active, archived, imported] = await Promise.all([
        scan(root),
        scan(archivedRoot),
        scan(importStoreDir("codex")),
      ]);
      return [...active, ...archived, ...imported];
    },
    transferFiles: async () => {
      const [active, archived] = await Promise.all([walkFiles(root, isRollout), walkFiles(archivedRoot, isRollout)]);
      return [...active, ...archived];
    },
    readSession: read,
  };
}
