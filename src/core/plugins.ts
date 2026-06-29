import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { walkFiles } from "./walk.js";
import { isRecord } from "./utils.js";

// Two questions, both answered from the locally-installed plugin cache
// (~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/):
//
//  • Which plugin owns a HOOK? Hook records carry only the command
//    ("${CLAUDE_PLUGIN_ROOT}/scripts/hook.sh …"), and the plugin's hooks.json
//    declares that exact command — so command -> plugin is an exact-string index.
//
//  • Which plugin SPAWNED an SDK session? A plugin hook can launch a headless
//    review via the Agent SDK; that child session records no link back. But the
//    plugin builds the review PROMPT from a literal template in its own source
//    (e.g. "Review this change for security vulnerabilities."), and the spawned
//    session's prompt starts with that verbatim string. So we harvest those
//    distinctive literals from SDK-calling plugins and match a session's prompt.
//
// Both only resolve plugins installed on THIS machine (imported/audit sessions
// from elsewhere won't resolve). Built lazily + cached, like the price sheet.

function pluginsCacheDir(): string {
  return join(process.env.AGTAIL_PLUGINS_DIR || join(homedir(), ".claude", "plugins"), "cache");
}

export interface PluginResolver {
  /** The plugin a hook's command belongs to (hooks.json exact match), if any. */
  forCommand: (command: string) => string | undefined;
  /** The plugin whose review-prompt template a spawned SDK session's prompt
   *  matches, if any. */
  forPrompt: (prompt: string) => string | undefined;
}

const memo: { resolver?: Promise<PluginResolver> } = {};

/** A cached resolver built from the local plugin cache. */
export function loadPluginResolver(): Promise<PluginResolver> {
  const built = memo.resolver ?? buildResolver();
  memo.resolver = built;
  return built;
}

/** Drop the cache (tests point AGTAIL_PLUGINS_DIR at a fixture between cases). */
export function resetPluginCache(): void {
  memo.resolver = undefined;
}

// We match only the prompt's FIRST line against plugin source — and require it to
// be this long and look like prose (≥ MIN_WORDS words). An audit over 253 real
// SDK sessions showed first-line matching is exact (74/74 reviews, 0 false
// positives), whereas matching interior lines/fragments to handle mid-line
// dynamic text misattributed a different plugin's sessions (its prompt shares
// interior phrasing with this one) — so we deliberately don't do that.
const MIN_FIRST_LINE = 30;
const MIN_WORDS = 4;
const SDK_MARKERS = [
  "claude_agent_sdk",
  "claude_code_sdk",
  "@anthropic-ai/claude-agent-sdk",
  "@anthropic-ai/claude-code",
];
// Scanned for both SDK markers (code) and prompt templates: a plugin may build
// its spawned-agent prompt inline in code, or ship it as a prompts/*.txt file.
const SOURCE_FILE = /\.(py|js|mjs|cjs|ts|md|txt|prompt)$/;
const VENDOR_DIR = /(?:^|[/\\])(?:node_modules|site-packages|__pycache__|\.venv|dist)(?:[/\\]|$)/;
// A file that holds an agent prompt template (so the plugin spawns sessions).
const PROMPT_FILE = /(?:[/\\]prompts[/\\]|\.prompt(?:\.txt)?$)/;

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Every installed plugin version dir, by the cache layout
 *  cache/<marketplace>/<plugin>/<version>/ — so prompt-only plugins (no
 *  hooks.json) are discovered too, not just hooked ones. */
async function pluginRoots(cacheDir: string): Promise<{ root: string; plugin: string }[]> {
  const out: { root: string; plugin: string }[] = [];
  for (const marketplace of await subdirs(cacheDir)) {
    for (const plugin of await subdirs(join(cacheDir, marketplace))) {
      for (const version of await subdirs(join(cacheDir, marketplace, plugin))) {
        out.push({ root: join(cacheDir, marketplace, plugin, version), plugin });
      }
    }
  }
  return out;
}

async function buildResolver(): Promise<PluginResolver> {
  const cacheDir = pluginsCacheDir();
  const byCommand = new Map<string, string>();
  // Each spawning plugin's source + prompt files. We match a session's prompt
  // AGAINST this (never the reverse), so program literals can't false-match.
  const spawners: { plugin: string; text: string }[] = [];
  for (const { root, plugin } of await pluginRoots(cacheDir)) {
    for (const cmd of await commandsOf(join(root, "hooks", "hooks.json"))) {
      if (!byCommand.has(cmd)) byCommand.set(cmd, plugin);
    }
    const text = await spawnerSourceText(root);
    if (text) spawners.push({ plugin, text });
  }

  return {
    forCommand: (command) => byCommand.get(command),
    forPrompt: (prompt) => attributePrompt(prompt, spawners),
  };
}

const wordCount = (line: string) => (line.match(/[A-Za-z0-9]+/g) ?? []).length;

/** Attribute a spawned session to a plugin: its prompt's FIRST line, if it's prose
 *  (≥ MIN_WORDS words) and long enough (≥ MIN_FIRST_LINE), must appear verbatim in
 *  exactly one spawning plugin's source/prompts. Only the first line is trusted —
 *  interior lines proved to collide across plugins (see the constants). Returns
 *  undefined on no match, a tie, or a dynamic/short first line. */
function attributePrompt(prompt: string, spawners: { plugin: string; text: string }[]): string | undefined {
  const first = (prompt.split("\n").find((l) => l.trim()) ?? "").trim();
  if (first.length < MIN_FIRST_LINE || wordCount(first) < MIN_WORDS) return undefined;
  // Uniqueness is on the plugin NAME, not entry count — a plugin can have several
  // installed versions (each a separate entry) that all contain the line.
  const names = new Set(spawners.filter((s) => s.text.includes(first)).map((s) => s.plugin));
  return names.size === 1 ? [...names][0] : undefined;
}

/** A plugin's concatenated source+prompts IF it can spawn sessions (calls the
 *  Agent SDK, or ships a prompt template), else "" — so we don't match prompts
 *  against doc-only plugins. */
async function spawnerSourceText(root: string): Promise<string> {
  const files = (await walkFiles(root, (n) => SOURCE_FILE.test(n))).filter((f) => !VENDOR_DIR.test(f));
  const texts = await Promise.all(files.map(readText));
  const all = texts.join("\n");
  const spawns = SDK_MARKERS.some((m) => all.includes(m)) || files.some((f) => PROMPT_FILE.test(f));
  return spawns ? all : "";
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

/** The command strings declared in one matcher group ({ hooks: [{command}] }). */
function commandsInGroup(group: unknown): string[] {
  const inner = isRecord(group) && Array.isArray(group.hooks) ? group.hooks : [];
  return inner
    .filter((h): h is { command: string } => isRecord(h) && typeof h.command === "string")
    .map((h) => h.command);
}

/** Every command string declared in a hooks.json (across all events/matchers).
 *  A malformed file is skipped rather than aborting the whole index. */
async function commandsOf(file: string): Promise<string[]> {
  const parsed = await readJson(file);
  if (!isRecord(parsed) || !isRecord(parsed.hooks)) return [];
  return Object.values(parsed.hooks)
    .filter(Array.isArray)
    .flatMap((groups) => groups.flatMap(commandsInGroup));
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null; // unreadable/malformed plugin config — skip it, don't crash
  }
}
