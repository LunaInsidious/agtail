import { useState, type KeyboardEvent } from "react";
import { loadRecent, RECENT_CAP, RECENT_KEY, RECENT_SHOWN } from "../lib/state.js";

// Recent text searches: a most-recently-used list persisted in localStorage and
// offered as suggestions under the search box. Recorded on blur/Enter (not per
// keystroke). `query` is the live search text; `applyQuery` runs the picked one.
export function useRecentSearches(query: string, applyQuery: (q: string) => void) {
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [recentOpen, setRecentOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1); // keyboard-highlighted suggestion (-1 = none)

  const pushRecent = (q: string) => {
    const v = q.trim();
    if (!v) return;
    setRecent((r) => {
      const next = [v, ...r.filter((x) => x !== v)].slice(0, RECENT_CAP);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  };
  const clearRecent = () => {
    localStorage.removeItem(RECENT_KEY);
    setRecent([]);
    setRecentOpen(false);
  };
  const selectRecent = (v: string) => {
    applyQuery(v); // live-search effect re-runs for the picked query
    pushRecent(v);
    setRecentOpen(false);
  };

  // Recent searches matching the current text (substring), newest first. Include
  // an exact match of the current text (so typing "hoge" still surfaces the saved
  // "hoge"); capped to the shown count.
  const needleLc = query.trim().toLowerCase();
  const recentMatches = recent.filter((r) => r.toLowerCase().includes(needleLc)).slice(0, RECENT_SHOWN);

  // ↓/Tab next, ↑/Shift+Tab prev, Enter accept the highlighted one, Esc close.
  const onSearchKey = (e: KeyboardEvent) => {
    const open = recentOpen && recentMatches.length > 0;
    if (e.key === "Escape") {
      if (recentOpen) {
        e.preventDefault(); // close the suggestions WITHOUT type=search's native clear
        setRecentOpen(false);
        setActiveIdx(-1);
      }
      return;
    }
    if (!open) return;
    const last = recentMatches.length - 1;
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, last));
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault(); // pick the highlight instead of submitting the form
      selectRecent(recentMatches[activeIdx]!);
    }
  };

  return { recentOpen, setRecentOpen, activeIdx, setActiveIdx, recentMatches, pushRecent, clearRecent, selectRecent, onSearchKey };
}
