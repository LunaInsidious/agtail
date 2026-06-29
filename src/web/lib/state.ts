// Constants, persistence and history-snapshot helpers for the web UI.
import type { Agent, Filters } from "./api.js";

export const AGENTS: Agent[] = ["claude-code", "codex"];

// Search result cap (matching events). User-selectable; 0 means no limit ("All").
// Hitting the cap means results were truncated and there may be more ("500+").
const DEFAULT_LIMIT = 500;
export const LIMIT_OPTIONS: { value: number; label: string }[] = [
  { value: 100, label: "100" },
  { value: 500, label: "500" },
  { value: 1000, label: "1,000" },
  { value: 5000, label: "5,000" },
  { value: 0, label: "All" },
];

// Recent text searches: a most-recently-used list persisted in localStorage and
// offered as suggestions on the search box. Recorded on blur/Enter (not per
// keystroke), so typing "hoge" never leaves "ho"/"hog" behind; distinct queries
// (incl. "ho" and "hoge") are kept as separate entries.
export const RECENT_KEY = "agtail.recent";
// Keep a large bounded history (like a shell history file — zsh's SAVEHIST
// defaults to 10000), but only ever SHOW a short list of suggestions and reach
// older ones by typing a fragment (as the browser address bar / Ctrl-R do).
// Autocomplete UX guidance: show ≤10 on desktop, more becomes noise.
//   https://baymard.com/blog/autocomplete-design
//   https://www.algolia.com/blog/ux/auto-suggest-best-practices-for-autocomplete-suggestion
//   https://www.w3tutorials.net/blog/bash-or-zsh-histsize-vs-histfilesize/  (HISTSIZE/SAVEHIST)
export const RECENT_CAP = 10000; // distinct queries retained in localStorage
export const RECENT_SHOWN = 10; // suggestions rendered in the dropdown at once
export function loadRecent(): string[] {
  const raw = localStorage.getItem(RECENT_KEY);
  if (!raw) return [];
  const v: unknown = JSON.parse(raw);
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

// Saved searches: a named, durable snapshot of the full filter set + limit, for
// recurring/audit queries. Recalled from the header "★ Saved" menu.
export const SAVED_KEY = "agtail.saved";
export type SavedSearch = { id: string; name: string; filters: Filters; limit: number };
export function loadSaved(): SavedSearch[] {
  const raw = localStorage.getItem(SAVED_KEY);
  if (!raw) return [];
  // Trust-boundary parse of our own localStorage payload; the persisted shape is
  // a SavedSearch[] (older entries may lack `id`). Runtime-validating the full
  // nested Filters here would be disproportionate, so cast the array shape and
  // backfill the legacy-missing fields below.
  // eslint-disable-next-line eslint-js/no-restricted-syntax -- localStorage trust boundary: our own SavedSearch[] payload; full Filters validation is disproportionate.
  const arr = (JSON.parse(raw) as Partial<SavedSearch>[]) ?? [];
  // Backfill ids for entries saved before they had one. Merge filters onto the
  // defaults so an older snapshot missing a newer field still gets that default.
  return arr.map((s) => ({
    id: s.id ?? crypto.randomUUID(),
    name: s.name ?? "Saved search",
    filters: { ...emptyFilters, ...s.filters },
    limit: s.limit ?? DEFAULT_LIMIT,
  }));
}

export const emptyFilters: Filters = {
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
};

// Filter/search state lives in the browser's history entry (history.state), not
// the URL: back/forward and reload both restore it, while the address bar stays
// clean so no local paths or search text ever leak into a shareable/synced URL.
export type HistorySnap = { filters: Filters; limit: number; open: { agent: Agent; id: string } | null };
export function readHistory(): HistorySnap {
  // history.state is `any`; this is our own snapshot. The fields are re-validated
  // on read below (filters merged onto defaults, limit type-checked), so the only
  // assertion is the entry's outer shape.
  // eslint-disable-next-line eslint-js/no-restricted-syntax -- history.state trust boundary: our own snapshot; fields are re-validated below.
  const s = (window.history.state?.agtail ?? null) as Partial<HistorySnap> | null;
  return {
    // Merge onto emptyFilters so an older snapshot missing a newer field still
    // gets that field's default.
    filters: { ...emptyFilters, ...s?.filters },
    limit: typeof s?.limit === "number" ? s.limit : DEFAULT_LIMIT,
    open: s?.open ?? null,
  };
}
