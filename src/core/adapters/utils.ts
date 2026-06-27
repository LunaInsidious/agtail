// Helpers shared across the session adapters (Claude Code, Codex).

// A session title is the first line of the first user prompt, capped so the
// session list stays scannable.
export function firstLine(text: string, max = 120): string {
  return (text.split("\n")[0] ?? "").slice(0, max);
}
