import { useEffect, useRef, useState } from "react";
import { apiFacets, apiSources } from "../lib/api.js";

type Facets = { tools: string[]; cwds: string[]; models: string[] };
type Source = { name: string; count: number };

/** Lookup data for the filter UI: facets (tool/model/cwd options) and imported
 *  sources (for the switcher). Facets are a full re-parse, so they load lazily on
 *  first Filters-popover open; sources are cheap and load up front. Both refresh
 *  when `refreshNonce` bumps (after an import). */
export function useLookups(showFilters: boolean, refreshNonce: number): { facets: Facets; sources: Source[] } {
  const [facets, setFacets] = useState<Facets>({ tools: [], cwds: [], models: [] });
  const [sources, setSources] = useState<Source[]>([]);

  const facetsNonce = useRef(-1);
  useEffect(() => {
    if (!showFilters || facetsNonce.current === refreshNonce) return;
    facetsNonce.current = refreshNonce;
    apiFacets().then(setFacets);
  }, [showFilters, refreshNonce]);

  useEffect(() => {
    apiSources().then(setSources);
  }, [refreshNonce]);

  return { facets, sources };
}
