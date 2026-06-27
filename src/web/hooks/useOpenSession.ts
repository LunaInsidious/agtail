import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiSession, type Agent, type Filters, type Session, type SessionHit } from "../lib/api.js";
import { sessionSig, type Seed } from "../lib/util.js";

export type OpenFn = (agent: Agent, id: string, withSeed?: Seed) => Promise<void>;

// Opening a session: serve instantly from an LRU cache when present (with
// stale-while-revalidate for a live session that may have grown), otherwise
// fetch. A sequence guard drops out-of-order resolutions so a slow earlier open
// can't clobber a newer one. Also handles "open this session's parent".
export function useOpenSession(mask: boolean, hits: SessionHit[] | null, setFilters: Dispatch<SetStateAction<Filters>>) {
  const [cur, setCur] = useState<Session | null>(null);
  const [seed, setSeed] = useState<Seed>({ find: "" });
  const [loading, setLoading] = useState(false);
  const openSeq = useRef(0); // guards against stale (out-of-order) open resolutions
  // LRU cache of opened sessions (events + usage), keyed by agent:id:mask, so
  // re-opening one — notably via back/forward — is instant with no refetch.
  const sessionCache = useRef(new Map<string, Session>());
  // When a row becomes the open session, the row whose id matches this ref is
  // scrolled to the TOP of the list (vs the default "scroll just into view");
  // set on a parent jump so the parent lands at the top. One-shot.
  const scrollTargetRef = useRef<string | null>(null);

  const open = useCallback<OpenFn>(
    async (agent, id, withSeed) => {
      setSeed(withSeed ?? { find: "" });
      const key = `${agent}:${id}:${mask ? 1 : 0}`;
      const cache = sessionCache.current;
      const store = (s: Session) => {
        cache.delete(key); // re-insert so the key becomes most-recently-used
        cache.set(key, s);
        if (cache.size > 12) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
      };
      // Guard against out-of-order resolutions: a slow earlier open must not
      // clobber a newer one (e.g. the mount restore vs. a quick click).
      const seq = ++openSeq.current;
      const cached = cache.get(key);
      if (cached) {
        // Show the cached session instantly, then revalidate in the background:
        // a live session may have grown, so refetch and swap in only if changed.
        cache.delete(key);
        cache.set(key, cached);
        setLoading(false);
        setCur(cached);
        void apiSession(agent, id, mask)
          .then((fresh) => {
            store(fresh);
            if (openSeq.current === seq && sessionSig(fresh) !== sessionSig(cached)) setCur(fresh);
          })
          .catch(() => {
            /* keep the cached view; a background revalidation failure is non-fatal */
          });
        return;
      }
      setLoading(true);
      try {
        const s = await apiSession(agent, id, mask);
        if (openSeq.current !== seq) return;
        store(s);
        setCur(s);
      } finally {
        if (openSeq.current === seq) setLoading(false);
      }
    },
    [mask],
  );

  // Opening a session's parent from the timeline header. If the parent is among
  // the current search results, stay in results and just open (its row gets the
  // active highlight). Otherwise clear the content search so the list drops back
  // to the full browse tree, where the parent lives in context. Either way the
  // parent row is scrolled to the top.
  const openParent = useCallback(
    (agent: Agent, id: string) => {
      const inResults = !!hits?.some((h) => h.sessionId === id);
      if (!inResults) setFilters((f) => ({ ...f, q: "", tools: [], since: "", until: "", kinds: [] }));
      scrollTargetRef.current = id;
      void open(agent, id);
    },
    [open, hits, setFilters],
  );

  return { cur, setCur, seed, loading, open, openParent, scrollTargetRef };
}
