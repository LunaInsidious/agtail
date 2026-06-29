import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { Agent, ArchivedFilter, ProgrammaticFilter, TriFilter } from "../core/types.js";
import { AGENTS, isAgent, isEventKind } from "../core/types.js";
import type { RootOverrides } from "../core/adapters/types.js";
import { findAllSessions, resolveSession } from "../core/adapters/index.js";
import { assertBundle, exportSessions, importSessions } from "../core/transfer.js";
import { listCollections } from "../core/imported.js";
import { matchingSessionRefs, search, searchSessions } from "../core/search.js";
import { aggregateUsage, costForModel, usageSum } from "../core/cost.js";
import { loadPriceResolver } from "../core/pricing.js";
import { displayRole, isHumanMessage, summarizeInput } from "../core/format.js";
import { mask as maskText, maskValue } from "../core/mask.js";
import { color, shortTs } from "./colors.js";
import type {
  ExportOpts,
  GlobalOpts,
  GrepOpts,
  ImportOpts,
  ListOpts,
  ServeOpts,
  ShowOpts,
  StatsOpts,
} from "./options.js";

const HOME = homedir();
const tilde = (p?: string) => (p ?? "?").replace(HOME, "~");

// Included by default; only|none narrows. Shared by --archived / --programmatic.
function triFilter(flag: string, v: string | undefined): TriFilter {
  if (v === "only" || v === "none") return v;
  if (v != null && v !== "all") {
    console.error(`${flag} must be one of: all, only, none (got: ${v})`);
    process.exit(2);
  }
  return "all";
}
const archivedFilter = (o: GlobalOpts): ArchivedFilter => triFilter("--archived", o.archived);
const programmaticFilter = (o: GlobalOpts): ProgrammaticFilter => triFilter("--programmatic", o.programmatic);

function overrides(o: GlobalOpts): RootOverrides {
  const ov: RootOverrides = {};
  if (o.claudeDir) ov["claude-code"] = o.claudeDir;
  if (o.codexDir) ov["codex"] = o.codexDir;
  return ov;
}

function parseAgents(v?: string): Agent[] | undefined {
  if (!v) return undefined;
  const items = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = items.filter((i) => !isAgent(i));
  if (bad.length) {
    console.error(`unknown agent(s): ${bad.join(", ")}. valid: ${AGENTS.join(", ")}`);
    process.exit(2);
  }
  return items.filter(isAgent);
}

const collect = (v: string, prev: string[]) => prev.concat([v]);
const agentTag = (a: Agent) => (a === "claude-code" ? "claude" : a);

// --- grep (primary) ----------------------------------------------------------
async function cmdGrep(pattern: string | undefined, opts: GrepOpts, global: GlobalOpts) {
  const filters = {
    pattern,
    regex: Boolean(opts.regex),
    ignoreCase: !opts.caseSensitive,
    agents: parseAgents(opts.agent),
    tools: opts.tool?.length ? opts.tool : undefined,
    cwds: opts.cwd ? [opts.cwd] : undefined,
    source: opts.source,
    since: opts.since,
    until: opts.until,
    kinds: opts.kind ? opts.kind.split(",").filter(isEventKind) : undefined,
    archived: archivedFilter(global),
    programmatic: programmaticFilter(global),
    mask: global.mask,
    limit: opts.limit ? Number(opts.limit) : undefined,
    overrides: overrides(global),
  };

  const counter = { hits: 0 };
  for await (const m of searchSessions(filters)) {
    counter.hits++;
    if (opts.json) {
      process.stdout.write(JSON.stringify(m) + "\n");
    } else {
      const where = `${agentTag(m.agent)}:${m.sessionId.slice(0, 8)}`;
      const tool = m.tool ? color(` ${m.tool}`, "amber") : "";
      console.log(
        `${color(where, "amber")} ${color(shortTs(m.ts), "gray")} ` + `${color(m.kind, "dim")}${tool}  ${m.snippet}`,
      );
    }
  }
  if (!counter.hits && !opts.json) console.log("no matches");
}

// --- list --------------------------------------------------------------------
async function cmdList(opts: ListOpts, global: GlobalOpts) {
  const all = await findAllSessions(parseAgents(opts.agent), overrides(global), {
    archived: archivedFilter(global),
    programmatic: programmaticFilter(global),
    source: opts.source,
  });
  const proj = opts.project?.toLowerCase();
  const pass = (m: (typeof all)[number]) =>
    (!proj || (m.cwd ?? "").toLowerCase().includes(proj)) &&
    (!opts.since || (m.ended ?? "") >= opts.since) &&
    (!opts.until || (m.started ?? "") <= opts.until);

  const sessions = all.filter(pass);
  // Group subagents under their parent so the tree is visible.
  const children = new Map<string, typeof sessions>();
  for (const m of sessions) {
    if (m.isSubagent && m.parentId) {
      const bucket = children.get(m.parentId) ?? [];
      bucket.push(m);
      children.set(m.parentId, bucket);
    }
  }
  const seenChild = new Set<string>();

  const row = (m: (typeof sessions)[number], indent: boolean) => {
    const lead = indent ? color("  ↳ ", "violet") : "";
    const tag = color(agentTag(m.agent).padEnd(indent ? 4 : 6), "violet");
    const sid = color(m.id.slice(0, 8), "amber");
    const when = color(shortTs(m.ended), "gray");
    const name = m.isSubagent && m.agentName ? color(`[${m.agentName}] `, "violet") : "";
    const arch =
      (m.archived ? color("🗄 archived ", "dim") : "") +
      (m.programmatic ? color(`🤖 ${m.origin ?? "programmatic"} `, "dim") : "");
    console.log(
      `${lead}${tag} ${sid}  ${when}  ${color(String(m.messages).padStart(4), "dim")} ev  ${color(tilde(m.cwd), "cyan")}`,
    );
    console.log(`${indent ? "      " : ""}         ${arch}${name}${global.mask ? maskText(m.title, true) : m.title}`);
  };

  for (const m of sessions) {
    if (m.isSubagent) continue; // rendered under its parent
    row(m, false);
    for (const c of children.get(m.id) ?? []) {
      row(c, true);
      seenChild.add(c.id);
    }
  }
  // Subagents whose parent was filtered out / not present: show standalone.
  for (const m of sessions) {
    if (m.isSubagent && !seenChild.has(m.id)) row(m, true);
  }
  if (!sessions.length) console.log("no sessions found");
}

// --- show --------------------------------------------------------------------
// eslint-disable-next-line sonarjs/cognitive-complexity -- top-level CLI command: resolves a session and prints it; one branch per output flag.
async function cmdShow(id: string, opts: ShowOpts, global: GlobalOpts) {
  const sess = await resolveSession(id, parseAgents(opts.agent), overrides(global));
  if (!sess) return console.log("no matching session:", id);
  const doMask = Boolean(global.mask);
  console.log(
    color(`${agentTag(sess.agent)} · ${sess.id}`, "bold") +
      (sess.archived ? color("  🗄 archived", "dim") : "") +
      (sess.programmatic ? color(`  🤖 ${sess.origin ?? "programmatic"}`, "dim") : ""),
  );
  if (sess.isSubagent) {
    console.log(color(`  ↳ subagent (${sess.agentName ?? "?"}) of ${sess.parentId}`, "violet"));
  }
  console.log(
    color(`  ${tilde(sess.cwd)}  branch=${sess.gitBranch ?? "-"}  ${sess.model ?? ""}  v${sess.version ?? "?"}`, "dim"),
  );
  console.log();
  const resolve = await loadPriceResolver(sess.models);
  // Per-turn token/cost badge for events carrying usage.
  const usageBadge = (e: (typeof sess.events)[number]) => {
    if (!e.usage) return "";
    const tok = usageSum(e.usage);
    const c = costForModel(e.usage, e.model, resolve);
    return color(`  [${tok.toLocaleString()} tok${c != null ? ` ≈$${c.toFixed(4)}` : " cost unknown"}]`, "green");
  };
  for (const e of sess.events) {
    if (opts.tools && e.kind !== "tool_use") continue;
    const ts = color(shortTs(e.ts), "gray");
    const sc = e.sidechain ? color("¦", "violet") + " " : "  ";
    if (e.kind === "tool_use") {
      const inp = summarizeInput(e.tool, doMask ? maskValue(e.input) : e.input);
      console.log(`${ts} ${sc}${color("⚙ " + (e.tool ?? "?"), "amber")}  ${inp}${usageBadge(e)}`);
      if (e.result) {
        const tag = e.result.isError ? color("✗", "red") : color("✓", "green");
        const snip = (doMask ? maskText(e.result.text, true) : e.result.text).replace(/\n/g, " ").slice(0, 140);
        console.log(`           ${tag} ${color(snip, "dim")}`);
      }
    } else if (e.kind === "text") {
      // Inside a sidechain, a "user" message is the parent agent, not the human.
      const who = isHumanMessage(e) ? "cyan" : e.sidechain && e.role === "user" ? "violet" : "rst";
      const body = (doMask ? maskText(e.text ?? "", true) : (e.text ?? "")).trim().replace(/\n/g, "\n           ");
      console.log(`${ts} ${sc}${color(displayRole(e), who)}: ${body.slice(0, 1000)}${usageBadge(e)}`);
    } else if (e.kind === "thinking") {
      console.log(
        `${ts} ${sc}${color("thinking", "violet")} ${color((e.text ?? "").slice(0, 120).replace(/\n/g, " "), "dim")}`,
      );
    } else if (e.kind === "hook") {
      console.log(`${ts} ${sc}${color("🪝 " + (e.text ?? ""), "amber")}`);
    } else if (e.kind === "summary") {
      console.log(`${ts} ${color("— " + (e.text ?? ""), "gray")}`);
    } else if (e.kind === "system") {
      console.log(`${ts} ${sc}${color("system", "gray")} ${color((e.text ?? "").slice(0, 120), "dim")}`);
    } else if (e.kind === "unknown") {
      console.log(`${ts} ${sc}${color("? " + (e.text ?? ""), "dim")}`);
    }
  }
}

// --- stats -------------------------------------------------------------------
async function cmdStats(id: string | undefined, opts: StatsOpts, global: GlobalOpts) {
  const agents = parseAgents(opts.agent);
  const ov = overrides(global);
  const sessions = id
    ? [await resolveSession(id, agents, ov)].filter(Boolean)
    : await Promise.all(
        (
          await findAllSessions(agents, ov, {
            archived: archivedFilter(global),
            programmatic: programmaticFilter(global),
          })
        )
          .filter((m) => !opts.project || (m.cwd ?? "").toLowerCase().includes(opts.project.toLowerCase()))
          .map((m) => resolveSession(m.id, [m.agent], ov)),
      );

  const counts = new Map<string, number>();
  const allEvents = [];
  for (const sess of sessions) {
    if (!sess) continue;
    for (const e of sess.events) {
      allEvents.push(e);
      if (e.kind === "tool_use") counts.set(e.tool ?? "?", (counts.get(e.tool ?? "?") ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  const maxN = Math.max(1, ...counts.values());
  for (const [tool, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const bar = "█".repeat(Math.round((30 * n) / maxN));
    console.log(
      `${color(tool.slice(0, 22).padEnd(22), "cyan")} ${String(n).padStart(5)} ` +
        `${String(Math.round((100 * n) / total)).padStart(3)}%  ${color(bar, "amber")}`,
    );
  }
  console.log(color(`${"total".padEnd(22)} ${String(total).padStart(5)}`, "dim"));

  const u = aggregateUsage(allEvents, await loadPriceResolver(allEvents.map((e) => e.model)));
  console.log();
  console.log(color("tokens", "bold"));
  console.log(
    `  input ${u.inputTokens.toLocaleString()}  output ${u.outputTokens.toLocaleString()}` +
      `  cache-read ${u.cacheReadTokens.toLocaleString()}  total ${u.totalTokens.toLocaleString()}`,
  );
  if (u.costUsd != null) console.log(`  cost ≈ $${u.costUsd.toFixed(4)} (approx)`);
  else console.log(color(`  cost: unknown (unpriced models: ${u.unpricedModels.join(", ") || "—"})`, "dim"));
}

// --- export / import ---------------------------------------------------------
async function cmdExport(opts: ExportOpts, global: GlobalOpts) {
  const agents = parseAgents(opts.agent);
  const ov = overrides(global);
  // Any filter flag narrows the export to matching sessions (re-run unbounded, so
  // nothing is dropped); with none, every native session is bundled.
  const hasFilter = Boolean(
    opts.query || opts.tool?.length || opts.model?.length || opts.cwd || opts.since || opts.until || opts.kind,
  );
  const selection = hasFilter
    ? await matchingSessionRefs({
        pattern: opts.query,
        agents,
        tools: opts.tool?.length ? opts.tool : undefined,
        models: opts.model?.length ? opts.model : undefined,
        cwds: opts.cwd ? [opts.cwd] : undefined,
        since: opts.since,
        until: opts.until,
        kinds: opts.kind ? opts.kind.split(",").filter(isEventKind) : undefined,
        archived: archivedFilter(global),
        programmatic: programmaticFilter(global),
        overrides: ov,
      })
    : undefined;
  const bundle = await exportSessions({ agents, selection }, ov);
  const json = JSON.stringify(bundle);
  if (opts.out) await writeFile(opts.out, json);
  else process.stdout.write(json + "\n");
  const scope = hasFilter ? ` from ${selection?.length ?? 0} matching session(s)` : "";
  console.error(`exported ${bundle.files.length} file(s)${scope}`);
}

async function cmdImport(file: string, opts: ImportOpts, global: GlobalOpts) {
  const mode = opts.to ?? "agtail";
  if (mode !== "native" && mode !== "agtail") {
    console.error(`--to must be one of: native, agtail (got: ${mode})`);
    process.exit(2);
  }
  const bundle: unknown = JSON.parse(await readFile(file, "utf-8"));
  assertBundle(bundle);
  const res = await importSessions(
    bundle,
    { mode, overwrite: Boolean(opts.overwrite), collection: opts.name },
    overrides(global),
  );
  console.log(`imported ${res.written}, skipped ${res.skipped}`);
}

// --- serve -------------------------------------------------------------------
async function cmdServe(opts: ServeOpts, global: GlobalOpts) {
  const { startServer } = await import("../server/index.js");
  await startServer({ port: Number(opts.port), overrides: overrides(global), mask: global.mask });
}

// --- wiring ------------------------------------------------------------------
const program = new Command();
program
  .name("agtail")
  .description("Cross-agent forensic search for coding-agent histories (Claude Code, Codex)")
  .option("--claude-dir <path>", "override Claude Code root (~/.claude/projects)")
  .option("--codex-dir <path>", "override Codex sessions root (~/.codex/sessions)")
  .option("--archived <mode>", "archived sessions: all (default) | only | none", "all")
  .option("--programmatic <mode>", "programmatic (SDK-driven) sessions: all (default) | only | none", "all")
  .option("--mask", "redact secrets in output");

// The --agent option is shared by every subcommand.
const AGENT_OPT = "--agent <agents>";
const AGENT_DESC = "limit to agents (comma-separated)";
const SINCE_OPT = "--since <date>";
const UNTIL_OPT = "--until <date>";
const SOURCE_OPT = "--source <name>";
const SOURCE_DESC = "restrict to one imported collection (see `agtail sources`)";

const g = (): GlobalOpts => program.opts();

program
  .command("grep <pattern>")
  .description("search across all sessions (the primary command)")
  .option(AGENT_OPT, "limit to agents (comma-separated: claude-code,codex)")
  .option("--tool <glob>", "restrict to a tool (repeatable; e.g. Bash, Write, 'mcp__*')", collect, [])
  .option("--cwd <substr>", "restrict to sessions whose cwd contains this")
  .option(SOURCE_OPT, SOURCE_DESC)
  .option(SINCE_OPT, "only events at/after this ISO date")
  .option(UNTIL_OPT, "only events at/before this ISO date")
  .option("--kind <kinds>", "restrict to event kinds (comma-separated)")
  .option("--regex", "treat pattern as a regular expression")
  .option("--case-sensitive", "case-sensitive match")
  .option("--limit <n>", "stop after n matches")
  .option("--json", "emit NDJSON (one match per line)")
  .action((pattern, opts) => cmdGrep(pattern, opts, g()));

// Allow filter-only search (no pattern) via an explicit empty arg too.
program
  .command("list")
  .description("list sessions across agents, newest first")
  .option(AGENT_OPT, AGENT_DESC)
  .option("--project <substr>", "filter by cwd substring")
  .option(SOURCE_OPT, SOURCE_DESC)
  .option(SINCE_OPT)
  .option(UNTIL_OPT)
  .action((opts) => cmdList(opts, g()));

program
  .command("sources")
  .description("list imported collections (one synced person/machine each)")
  .action(() => console.log(listCollections().join("\n") || "no imported collections"));

program
  .command("show <id>")
  .description("print one session's timeline")
  .option(AGENT_OPT, AGENT_DESC)
  .option("--tools", "show tool calls only")
  .action((id, opts) => cmdShow(id, opts, g()));

program
  .command("stats [id]")
  .description("tool-usage counts + token/cost aggregation")
  .option(AGENT_OPT, AGENT_DESC)
  .option("--project <substr>", "filter by cwd substring")
  .action((id, opts) => cmdStats(id, opts, g()));

program
  .command("export")
  .description("bundle native sessions into a portable JSON export (to sync across machines)")
  .option(AGENT_OPT, AGENT_DESC)
  .option("-o, --out <file>", "write the bundle to a file (default: stdout)")
  // Filters select which sessions to bundle (each match exports its whole
  // transcript). With none, every session is exported.
  .option("--query <text>", "only sessions whose content matches this text")
  .option("--tool <glob>", "only sessions using a tool (repeatable; e.g. Bash, 'mcp__*')", collect, [])
  .option("--model <name>", "only sessions using a model (repeatable)", collect, [])
  .option("--cwd <substr>", "only sessions whose cwd contains this")
  .option(SINCE_OPT, "only sessions with activity at/after this ISO date")
  .option(UNTIL_OPT, "only sessions with activity at/before this ISO date")
  .option("--kind <kinds>", "only sessions with these event kinds (comma-separated)")
  .action((opts) => cmdExport(opts, g()));

program
  .command("import <file>")
  .description("import a session bundle (default into agtail's import store)")
  .option("--to <dest>", "destination: native (agent dirs) | agtail (import store)", "agtail")
  .option("--name <collection>", "agtail collection to import into (groups this source; default 'imported')")
  .option("--overwrite", "overwrite files that already exist at the destination")
  .action((file, opts) => cmdImport(file, opts, g()));

program
  .command("serve")
  .description("launch the local web UI (127.0.0.1 only)")
  .option("--port <n>", "port", "8765")
  .action((opts) => cmdServe(opts, g()));

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

export { search };
