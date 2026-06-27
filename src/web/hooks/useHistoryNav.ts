import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Filters, Session } from "../lib/api.js";
import { readHistory, type HistorySnap } from "../lib/state.js";
import type { OpenFn } from "./useOpenSession.js";

// Browser history (back/forward + reload) carries the filters, the result cap,
// AND the open session — never the URL, so no local paths or query text leak.
// Discrete navigation (open a session, flip a chip, change the cap) gets its own
// entry immediately; query typing settles into one debounced entry.
export function useHistoryNav({
  filters,
  limit,
  cur,
  open,
  setFilters,
  setLimit,
  setCur,
  setManageSaved,
}: {
  filters: Filters;
  limit: number;
  cur: Session | null;
  open: OpenFn;
  setFilters: Dispatch<SetStateAction<Filters>>;
  setLimit: Dispatch<SetStateAction<number>>;
  setCur: Dispatch<SetStateAction<Session | null>>;
  setManageSaved: Dispatch<SetStateAction<boolean>>;
}) {
  // histRef holds the snapshot already in history so a popstate/init never
  // re-pushes it; skipFirstPush drops the one push that would otherwise fire for
  // the already-in-history mount state.
  const histRef = useRef("");
  const skipFirstPush = useRef(true);
  // Keep the latest `open` reachable from the once-registered popstate listener.
  const openRef = useRef(open);
  openRef.current = open;

  // Push the CURRENT render's state as a new back-able history entry, deduped
  // against the entry already in history. Defined per-render so it closes over
  // the live filters/limit/cur (no stale snapshot).
  const pushSnap = () => {
    const snap: HistorySnap = { filters, limit, open: cur ? { agent: cur.agent, id: cur.id } : null };
    const s = JSON.stringify(snap);
    if (s === histRef.current) return; // already the current entry
    histRef.current = s;
    // Filter/open snapshot lives at the root path (never the /saved manage URL).
    window.history.pushState({ agtail: snap }, "", "/");
  };
  // Signatures that should create an entry the instant they change (discrete
  // navigation), vs the query text which is debounced while typing.
  const openSig = cur ? `${cur.agent}:${cur.id}` : "";
  const chipSig = JSON.stringify([
    filters.agents, filters.tools, filters.models, filters.cwds, filters.since,
    filters.until, filters.kinds, filters.mask, filters.archived, filters.programmatic, limit,
  ]);

  // On mount, restore the open session recorded in history (filters/limit were
  // already seeded into useState). histRef is set to the restored snapshot so the
  // restore's own state change doesn't get re-pushed as a new entry.
  useEffect(() => {
    const snap = readHistory();
    histRef.current = JSON.stringify(snap);
    if (snap.open) void open(snap.open.agent, snap.open.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open a session, change a chip, or change the cap → its own entry immediately,
  // so browsing sessions is fully back/forward-able however fast you click. The
  // first run is the already-in-history mount state, so it's skipped.
  useEffect(() => {
    if (skipFirstPush.current) {
      skipFirstPush.current = false;
      return;
    }
    pushSnap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSig, chipSig]);

  // Typing in the query box settles into a single entry — debounced.
  useEffect(() => {
    const t = setTimeout(pushSnap, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q]);

  // Back/forward: restore the snapshot — filters, limit, and the open session.
  useEffect(() => {
    const onPop = () => {
      const snap = readHistory();
      histRef.current = JSON.stringify(snap);
      setFilters(snap.filters);
      setLimit(snap.limit);
      if (snap.open) void openRef.current(snap.open.agent, snap.open.id);
      else setCur(null);
      setManageSaved(window.location.pathname === "/saved"); // open/close manage to match the URL
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
