// Pure helpers for filter display & saved-search naming. Kept DOM-free so they
// can be unit-tested in Vitest (the UI integration is covered by the e2e suite).
import type { Agent, Filters } from "./api.js";

export const tag = (a: Agent) => (a === "claude-code" ? "claude" : a);

export const homeShort = (p: string) => p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");

// Filter conditions as display chips (everything except q, which lives in the
// search box). Shared by the applied-filter bar and the saved-search displays.
export function filterChips(f: Filters): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const a of f.agents) out.push({ key: "agent:" + a, label: tag(a) });
  for (const t of f.tools) out.push({ key: "tool:" + t, label: "⚙ " + t });
  for (const m of f.models) out.push({ key: "model:" + m, label: "✦ " + m });
  for (const c of f.cwds) out.push({ key: "cwd:" + c, label: "📁 " + homeShort(c) });
  if (f.since) out.push({ key: "since", label: "≥ " + f.since });
  if (f.until) out.push({ key: "until", label: "≤ " + f.until });
  if (f.archived !== "all") out.push({ key: "status", label: f.archived === "only" ? "🗄 archived" : "active only" });
  if (f.programmatic !== "all")
    out.push({ key: "origin", label: f.programmatic === "only" ? "🤖 programmatic" : "interactive only" });
  if (f.mask) out.push({ key: "mask", label: "🔒 mask" });
  return out;
}

// Full condition chips incl. the query, for showing what a saved search holds.
export function savedChips(f: Filters): { key: string; label: string }[] {
  const out = filterChips(f);
  if (f.q.trim()) out.unshift({ key: "q", label: `🔎 "${f.q.trim()}"` });
  return out;
}

// A short default name for a saved search (renamed later if wanted). Shows the
// first couple of conditions so different searches don't all collapse to the
// same name (e.g. "claude · ✦ opus +3" rather than "claude +4").
export function defaultSavedName(f: Filters): string {
  const chips = savedChips(f);
  if (!chips.length) return "Saved search";
  const head = chips
    .slice(0, 2)
    .map((c) => c.label)
    .join(" · ");
  const rest = chips.length - 2;
  return rest > 0 ? `${head} +${rest}` : head;
}

// Avoid duplicate saved-search names by appending " (2)", " (3)", …
export function uniqueName(base: string, taken: string[]): string {
  const set = new Set(taken);
  const nth = (n: number): string => {
    const candidate = `${base} (${n})`;
    return set.has(candidate) ? nth(n + 1) : candidate;
  };
  return set.has(base) ? nth(2) : base;
}
