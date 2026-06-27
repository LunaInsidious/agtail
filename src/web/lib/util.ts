// Small display helpers shared across the web UI components.
import type { Session } from "./api.js";

// Search context carried from a hit into the opened session's in-view search.
export type Seed = { find: string; tool?: string };

// Human-readable label for a programmatic session's launch origin (Claude's
// entrypoint or Codex's originator), so "what is this?" is answerable at a glance.
export function originLabel(origin?: string): string {
  if (!origin) return "programmatic";
  const o = origin.toLowerCase();
  if (o.startsWith("sdk")) {
    if (o.includes("py")) return "Agent SDK (Python)";
    if (o.includes("ts") || o.includes("node") || o.includes("js")) return "Agent SDK (TypeScript)";
    if (o.includes("cli")) return "Agent SDK (CLI)";
    return "Agent SDK";
  }
  if (o === "claude-desktop") return "Desktop app";
  return origin; // e.g. a Codex originator name
}

export const PROGRAMMATIC_TIP =
  "Programmatic session — launched by tooling (the Agent SDK, a hook, plugin, script, or the desktop app), not typed interactively by a person.";

// Cheap signature to detect that a cached session changed (a live one grew):
// event count + last-event time. Append-only logs make this reliable enough to
// avoid a needless re-render when the revalidated copy is identical.
export const sessionSig = (s: Session) => `${s.events.length}:${s.ended ?? ""}`;

export const fmtTs = (ts?: string) => {
  if (!ts) return "";
  const d = new Date(ts);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export const pretty = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));
