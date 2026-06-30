import type { PluginResolver } from "../../core/plugins.js";

// The playground can't read ~/.claude/plugins, so it bundles the signatures of
// the plugins the sample uses. Mirrors core/plugins.ts: a hook command maps to
// its plugin by exact string; an SDK session maps by its prompt's first line
// appearing verbatim in exactly one plugin's source (≥30 chars, ≥4 words).
const MIN_FIRST_LINE = 30;
const MIN_WORDS = 4;

const SECURITY_GUIDANCE = "security-guidance";

// command (verbatim, as recorded in the transcript) -> owning plugin.
const COMMANDS: Record<string, string> = {
  'bash "${CLAUDE_PLUGIN_ROOT}/hooks/sg-python.sh"': SECURITY_GUIDANCE,
  'bash "${CLAUDE_PLUGIN_ROOT}/scripts/session-start-hook.sh"': SECURITY_GUIDANCE,
};

// A spawning plugin's prompt-template text (what an SDK session's prompt starts
// with). Same two fixtures the docs/tests use.
const SPAWNERS: { plugin: string; text: string }[] = [
  { plugin: SECURITY_GUIDANCE, text: "Review this change for security vulnerabilities." },
  { plugin: "remember", text: "You are summarizing a Claude Code session for a daily memory log." },
];

const wordCount = (line: string) => (line.match(/[A-Za-z0-9]+/g) ?? []).length;

export const playgroundPlugins: PluginResolver = {
  forCommand: (command) => COMMANDS[command],
  forPrompt: (prompt) => {
    const first = (prompt.split("\n").find((l) => l.trim()) ?? "").trim();
    if (first.length < MIN_FIRST_LINE || wordCount(first) < MIN_WORDS) return undefined;
    const names = new Set(SPAWNERS.filter((s) => s.text.includes(first)).map((s) => s.plugin));
    return names.size === 1 ? [...names][0] : undefined;
  },
};
