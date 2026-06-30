import type { Agent, Filters, SessionMeta } from "../lib/api.js";
import { displayRole, summarizeInput } from "../../core/format.js";
import { apiSearch, apiSession, apiSessions, apiSources } from "./backend.js";

// A tiny `agtail` command runner for the playground terminal. It maps the CLI's
// read commands onto the same in-browser backend the GUI uses, and formats plain
// text (no ANSI) for the console. Not the real commander CLI — a faithful subset.

const HELP = [
  "agtail playground terminal — a subset of the real CLI, running in your browser:",
  "  list [--agent a] [--project substr]            list sessions, newest first",
  "  grep <pattern> [--tool t] [--agent a]          search across sessions",
  "                 [--since d] [--until d] [--limit n]",
  "  show <id> [--tools]                            print a session's timeline",
  "  stats [id]                                     tool counts + token/cost",
  "  sources                                        imported collections",
  "  help                                           this message",
  "  clear                                          clear the screen",
];

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const clip = (s: string, n = 160): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};
const shortTs = (ts?: string): string => {
  if (!ts) return " ".repeat(14);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 19);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const agentTag = (a: Agent): string => (a === "claude-code" ? "claude" : "codex");
const money = (n: number | null | undefined): string => (n == null ? "  ?" : `$${n.toFixed(4)}`);

function tokenize(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

interface Parsed {
  positionals: string[];
  flags: Record<string, string | true>;
}
function parseArgs(tokens: string[]): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  const cur = { i: 0 };
  while (cur.i < tokens.length) {
    const t = tokens[cur.i];
    if (t === undefined) break;
    if (!t.startsWith("--")) {
      positionals.push(t);
      cur.i++;
      continue;
    }
    const eq = t.indexOf("=");
    if (eq >= 0) {
      flags[t.slice(2, eq)] = t.slice(eq + 1);
      cur.i++;
      continue;
    }
    const next = tokens[cur.i + 1];
    if (next != null && !next.startsWith("--")) {
      flags[t.slice(2)] = next;
      cur.i += 2;
    } else {
      flags[t.slice(2)] = true;
      cur.i++;
    }
  }
  return { positionals, flags };
}

const flagStr = (flags: Record<string, string | true>, key: string): string =>
  typeof flags[key] === "string" ? flags[key] : "";
const toAgents = (v: string): Agent[] =>
  v
    ? v
        .split(",")
        .map((s) => (s.trim() === "codex" ? "codex" : "claude-code"))
        .filter((x, i, a) => a.indexOf(x) === i)
    : [];

const baseFilters = (over: Partial<Filters>): Filters => ({
  q: "",
  agents: [],
  tools: [],
  models: [],
  cwds: [],
  since: "",
  until: "",
  kinds: [],
  mask: false,
  source: "",
  archived: "all",
  programmatic: "all",
  ...over,
});

function sessionLine(s: SessionMeta): string {
  const sub = s.isSubagent ? "  ↳ " : "";
  return `${sub}${pad(agentTag(s.agent), 6)} ${s.id.slice(0, 8)}  ${shortTs(s.ended)}  ${pad(`${s.messages} events`, 11)} ${s.cwd ?? ""}`;
}

async function runList(p: Parsed): Promise<string[]> {
  const project = flagStr(p.flags, "project");
  const sessions = await apiSessions({
    agents: toAgents(flagStr(p.flags, "agent")),
    cwds: project ? [project] : [],
  });
  if (!sessions.length) return ["(no sessions)"];
  return sessions.flatMap((s) => [sessionLine(s), `       ${clip(s.title, 120)}`]);
}

async function runGrep(p: Parsed): Promise<string[]> {
  const pattern = p.positionals.join(" ");
  const limit = Number(flagStr(p.flags, "limit")) || 200;
  const tool = flagStr(p.flags, "tool");
  const hits = await apiSearch(
    baseFilters({
      q: pattern,
      agents: toAgents(flagStr(p.flags, "agent")),
      tools: tool ? [tool] : [],
      since: flagStr(p.flags, "since"),
      until: flagStr(p.flags, "until"),
    }),
    limit,
  );
  if (!hits.length) return [`no results for ${JSON.stringify(pattern)}`];
  const head = `${hits.length} result${hits.length === 1 ? "" : "s"}${pattern ? ` for ${JSON.stringify(pattern)}` : ""}`;
  return [
    head,
    ...hits.flatMap((h) => [
      `${pad(agentTag(h.agent), 6)} ${h.sessionId.slice(0, 8)}  ${pad(`${h.matchCount} match`, 9)} ${clip(h.title, 90)}`,
      ...(h.snippet ? [`       ${clip(h.snippet, 120)}`] : []),
    ]),
  ];
}

async function resolveMeta(id: string): Promise<SessionMeta | undefined> {
  const all = await apiSessions({});
  return all.find((s) => s.id === id) ?? all.find((s) => s.id.startsWith(id));
}

async function runShow(p: Parsed): Promise<string[]> {
  const id = p.positionals[0];
  if (!id) return ["usage: show <id> [--tools]"];
  const meta = await resolveMeta(id);
  if (!meta) return [`no session matching ${JSON.stringify(id)}`];
  const sess = await apiSession(meta.agent, meta.id, false);
  const toolsOnly = p.flags.tools === true;
  const events = toolsOnly ? sess.events.filter((e) => e.kind === "tool_use") : sess.events;
  const header = `${agentTag(sess.agent)} ${sess.id.slice(0, 8)} · ${sess.title}`;
  return [header, ...events.map(showEvent)];
}

function showEvent(e: {
  kind: string;
  role?: string;
  sidechain?: boolean;
  tool?: string;
  text?: string;
  input?: unknown;
  hookEvent?: string;
  tokens?: number;
  cost?: number | null;
}): string {
  const ts = shortTs(undefined);
  const cost = e.tokens != null ? `  [${e.tokens.toLocaleString()} tok ${money(e.cost)}]` : "";
  if (e.kind === "tool_use") return `${ts} ${pad(e.tool ?? "tool", 10)} ${clip(summarizeInput(e.tool, e.input), 120)}`;
  if (e.kind === "hook") return `${ts} ${pad(`hook:${e.hookEvent ?? ""}`, 10)} ${clip(e.text ?? "", 120)}`;
  const label = e.kind === "thinking" ? "think" : displayRole({ role: e.role, sidechain: e.sidechain });
  return `${ts} ${pad(label, 10)} ${clip(e.text ?? "", 140)}${cost}`;
}

interface Totals {
  tokens: number;
  cost: number;
  unpriced: boolean;
}

/** Fold one session's tool counts and token/cost into the running totals. */
function accumulate(
  sess: { events: { kind: string; tool?: string }[]; usage?: { totalTokens: number; costUsd: number | null } },
  tools: Map<string, number>,
  totals: Totals,
): void {
  for (const e of sess.events) if (e.kind === "tool_use" && e.tool) tools.set(e.tool, (tools.get(e.tool) ?? 0) + 1);
  totals.tokens += sess.usage?.totalTokens ?? 0;
  if (sess.usage?.costUsd == null) totals.unpriced = true;
  else totals.cost += sess.usage.costUsd;
}

async function runStats(p: Parsed): Promise<string[]> {
  const id = p.positionals[0];
  const found = id ? [await resolveMeta(id)] : await apiSessions({});
  const metas = found.filter((m): m is SessionMeta => Boolean(m));
  if (!metas.length) return [id ? `no session matching ${JSON.stringify(id)}` : "(no sessions)"];
  const tools = new Map<string, number>();
  const totals: Totals = { tokens: 0, cost: 0, unpriced: false };
  for (const m of metas) accumulate(await apiSession(m.agent, m.id, false), tools, totals);
  const toolLine = [...tools.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ${n}`)
    .join(", ");
  const scope = id ? `session ${metas[0]?.id.slice(0, 8)}` : `${metas.length} sessions`;
  return [
    scope,
    `  tools:  ${toolLine || "(none)"}`,
    `  tokens: ${totals.tokens.toLocaleString()}   cost: ${totals.unpriced ? "unknown" : `$${totals.cost.toFixed(4)}`}`,
  ];
}

async function runSources(): Promise<string[]> {
  const sources = await apiSources();
  if (!sources.length) return ["(no imported collections — use the Import button or the app view)"];
  return sources.map((s) => `${pad(s.name, 20)} ${s.count} session${s.count === 1 ? "" : "s"}`);
}

const COMMANDS: Record<string, (p: Parsed) => Promise<string[]>> = {
  list: runList,
  grep: runGrep,
  search: runGrep,
  show: runShow,
  stats: runStats,
  sources: () => runSources(),
};

/** Run one input line, returning output lines. `clear` is signalled by null. */
export async function runCommand(line: string): Promise<string[] | null> {
  const tokens = tokenize(line.trim());
  const body = tokens[0] === "agtail" ? tokens.slice(1) : tokens;
  const head = body[0];
  if (!head) return [];
  if (head === "clear") return null;
  if (head === "help" || head === "--help" || head === "-h") return HELP;
  const handler = COMMANDS[head];
  if (!handler) return [`unknown command: ${head} (try "help")`];
  try {
    return await handler(parseArgs(body.slice(1)));
  } catch (err) {
    return [`error: ${err instanceof Error ? err.message : String(err)}`];
  }
}
