import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Filters } from "../lib/api.js";
import { defaultSavedName, uniqueName } from "../lib/filters.js";
import { emptyFilters, loadSaved, SAVED_KEY, type SavedSearch } from "../lib/state.js";

// Saved searches: named, durable snapshots of the full filter set + cap, for
// recurring/audit queries. The "Saved" dropdown recalls them; a dedicated manage
// screen at the /saved URL lists/renames/deletes them. `anyFilter` gates saving
// (nothing to save with no filter active).
export function useSavedSearches({
  filters,
  limit,
  anyFilter,
  setFilters,
  setLimit,
}: {
  filters: Filters;
  limit: number;
  anyFilter: boolean;
  setFilters: Dispatch<SetStateAction<Filters>>;
  setLimit: Dispatch<SetStateAction<number>>;
}) {
  const [saved, setSaved] = useState<SavedSearch[]>(loadSaved);
  const [showSaved, setShowSaved] = useState(false);
  // The "Saved searches" manage screen lives at the /saved URL (so Back closes it).
  const [manageSaved, setManageSaved] = useState(() => window.location.pathname === "/saved");
  // Save flow: an inline name field opens pre-filled with an auto-name (focused
  // and selected), so Enter accepts as-is or typing replaces it — no ugly prompt.
  const [namingDraft, setNamingDraft] = useState<string | null>(null);
  const savedRef = useRef<HTMLDivElement>(null);

  // The saved search the current filters/limit exactly match (if any) — drives
  // the "★ <name>" highlight instead of lighting up whenever any saved exists.
  const curKey = JSON.stringify({ filters, limit });
  const activeSaved = saved.find(
    (s) => JSON.stringify({ filters: { ...emptyFilters, ...s.filters }, limit: s.limit }) === curKey,
  );

  const persistSaved = (next: SavedSearch[]) => {
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    setSaved(next);
  };
  const startNaming = () =>
    setNamingDraft(
      uniqueName(
        defaultSavedName(filters),
        saved.map((s) => s.name),
      ),
    );
  const commitSave = () => {
    if (!anyFilter || activeSaved) return; // nothing to save / these conditions already saved
    const base = (namingDraft ?? "").trim() || defaultSavedName(filters);
    const name = uniqueName(
      base,
      saved.map((s) => s.name),
    ); // never collide with an existing name
    persistSaved([{ id: crypto.randomUUID(), name, filters, limit }, ...saved]);
    setNamingDraft(null);
    setShowSaved(false);
  };
  const applySaved = (s: SavedSearch) => {
    leaveManageUrl(); // if applying from the manage screen, turn its /saved entry into "/"
    setFilters({ ...emptyFilters, ...s.filters }); // merge so older snapshots get new defaults
    setLimit(s.limit);
    setShowSaved(false);
    setManageSaved(false);
  };
  const renameSaved = (id: string, name: string) => persistSaved(saved.map((s) => (s.id === id ? { ...s, name } : s)));
  const deleteSaved = (id: string) => persistSaved(saved.filter((s) => s.id !== id));
  // The manage screen is its own URL (/saved) so Back/forward, reload, and the
  // Done button all work. Only the path is exposed — no query content. (The
  // server falls back to index.html for unknown paths, so /saved reloads.)
  const openManage = () => {
    setShowSaved(false);
    setManageSaved(true);
    window.history.pushState(window.history.state, "", "/saved");
  };
  // Leave /saved by replacing it with "/" (robust even if /saved was opened
  // directly); browser Back is handled separately by the popstate listener.
  const leaveManageUrl = () => {
    if (window.location.pathname === "/saved") window.history.replaceState(window.history.state, "", "/");
  };
  const closeManage = () => {
    setManageSaved(false);
    leaveManageUrl();
  };

  // Drop any half-typed name when the Saved dropdown closes.
  useEffect(() => {
    if (!showSaved) setNamingDraft(null);
  }, [showSaved]);

  return {
    saved,
    showSaved,
    setShowSaved,
    manageSaved,
    setManageSaved,
    namingDraft,
    setNamingDraft,
    savedRef,
    activeSaved,
    startNaming,
    commitSave,
    applySaved,
    renameSaved,
    deleteSaved,
    openManage,
    closeManage,
  };
}
