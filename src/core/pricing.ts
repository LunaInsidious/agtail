import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Model prices are sourced from LiteLLM's community-maintained price sheet, so
// we don't hand-maintain a table. The file is fetched once and cached on disk;
// a model not listed there yields cost = null (we never guess a price).
const LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
// Cache under XDG_CACHE_HOME (falling back to ~/.cache per the XDG spec).
// Read lazily so a test (or a relocated cache) is picked up without a reimport.
const cacheDir = () => join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "agtail");
const cacheFile = () => join(cacheDir(), "litellm_prices.json");
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // routine refetch cadence (weekly)
// When asked to price a model the cached sheet doesn't know, refetch on demand —
// it may be newly added to LiteLLM. Bounded by the cache's age so a genuinely
// unpriced model (local/custom) doesn't trigger a fetch on every lookup/run.
const SOFT_REFRESH_MS = 60 * 60 * 1000; // at most hourly

/** Normalized price, USD per 1,000,000 tokens. */
export interface Price {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export type PriceResolver = (model: string | undefined) => Price | null;

interface LiteLLMEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
}

type Sheet = Record<string, LiteLLMEntry>;

async function cacheAgeMs(): Promise<number> {
  if (!existsSync(cacheFile())) return Infinity;
  try {
    return Date.now() - (await stat(cacheFile())).mtimeMs;
  } catch {
    return Infinity;
  }
}

async function readCache(): Promise<Sheet | null> {
  try {
    return JSON.parse(await readFile(cacheFile(), "utf-8"));
  } catch {
    return null; // missing or corrupt
  }
}

async function fetchAndCache(): Promise<Sheet | null> {
  try {
    const res = await fetch(LITELLM_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(cacheFile(), text);
    return JSON.parse(text);
  } catch (err) {
    // Offline: a stale cache is still real pricing; use it rather than nothing.
    const cached = await readCache();
    if (cached) return cached;
    console.error(
      `agtail: could not load LiteLLM prices (${err instanceof Error ? err.message : String(err)}); costs will show as unknown.`,
    );
    return null;
  }
}

async function loadRawPrices(): Promise<Sheet | null> {
  if ((await cacheAgeMs()) < TTL_MS) {
    const cached = await readCache();
    if (cached) return cached;
  }
  return fetchAndCache();
}

const M = 1_000_000;

function toPrice(e: LiteLLMEntry): Price | null {
  if (e.input_cost_per_token == null && e.output_cost_per_token == null) return null;
  return {
    input: (e.input_cost_per_token ?? 0) * M,
    output: (e.output_cost_per_token ?? 0) * M,
    cacheRead: e.cache_read_input_token_cost != null ? e.cache_read_input_token_cost * M : undefined,
    cacheWrite: e.cache_creation_input_token_cost != null ? e.cache_creation_input_token_cost * M : undefined,
  };
}

const stripDate = (s: string) => s.replace(/-\d{8}$/, "");

interface Resolver {
  price: PriceResolver;
  /** Whether the sheet knows this model at all — a real price OR an absent
   *  marker. This (not the price being null) is what gates a refetch. */
  knows: (model: string | undefined) => boolean;
}

/** Build a resolver from the sheet. Matches by exact id, the part after a
 *  provider "/", and with a trailing -YYYYMMDD date stripped (same model). */
function buildResolver(raw: Sheet | null): Resolver {
  const index = new Map<string, LiteLLMEntry>();
  const add = (key: string, e: LiteLLMEntry) => {
    const k = key.toLowerCase();
    if (!index.has(k)) index.set(k, e);
    if (!index.has(stripDate(k))) index.set(stripDate(k), e);
  };
  for (const [key, entry] of Object.entries(raw ?? {})) {
    add(key, entry);
    const slash = key.lastIndexOf("/");
    if (slash >= 0) add(key.slice(slash + 1), entry);
  }
  const lookup = (model: string | undefined): LiteLLMEntry | undefined => {
    if (!model) return undefined;
    const m = model.toLowerCase();
    return index.get(m) ?? index.get(stripDate(m));
  };
  return {
    price: (model) => {
      const e = lookup(model);
      return e ? toPrice(e) : null;
    },
    knows: (model) => lookup(model) !== undefined,
  };
}

// Process-level memo. A model confirmed missing is written back into the sheet as
// an empty (price-less) marker — so it reads as "known, no price" and persists in
// the same cache file, costing at most one on-demand refetch. A sheet refetch
// overwrites the file, dropping the markers so they get re-checked.
const memo: { sheet: Sheet | null; resolver: Resolver | null } = { sheet: null, resolver: null };

/** Drop the in-memory price cache so the next loadPriceResolver re-reads from disk
 *  (after a manual cache update, or to isolate tests). */
export function resetPriceCache(): void {
  memo.sheet = null;
  memo.resolver = null;
}

async function ensureLoaded(): Promise<Resolver> {
  if (!memo.resolver) {
    memo.sheet = await loadRawPrices();
    memo.resolver = buildResolver(memo.sheet);
  }
  return memo.resolver;
}

// Persist still-unknown models as empty markers in the sheet so they aren't
// refetched again until the routine TTL brings in (and overwrites with) a fresh sheet.
async function markAbsent(models: string[]): Promise<Resolver> {
  const sheet: Sheet = { ...memo.sheet };
  for (const m of models) sheet[m] = {};
  const resolver = buildResolver(sheet);
  memo.sheet = sheet;
  memo.resolver = resolver;
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(cacheFile(), JSON.stringify(sheet));
  } catch {
    /* best-effort: persistence failure just means we may refetch next run */
  }
  return resolver;
}

// A seen model the sheet doesn't know might be newly added upstream — refetch once
// (if the cache is stale enough that a miss could be new), then mark whatever is
// still missing absent so it isn't refetched again.
async function refreshForUnknown(seenModels: Iterable<string | undefined>): Promise<Resolver> {
  const current = await ensureLoaded();
  const unknown = [...seenModels].filter((m): m is string => !!m && !current.knows(m));
  if (!unknown.length) return current;
  const fresh = (await cacheAgeMs()) > SOFT_REFRESH_MS ? await fetchAndCache() : null;
  const refreshed = fresh ? buildResolver(fresh) : current;
  if (fresh) {
    memo.sheet = fresh;
    memo.resolver = refreshed;
  }
  const stillMissing = unknown.filter((m) => !refreshed.knows(m));
  return stillMissing.length ? markAbsent(stillMissing) : refreshed;
}

/** A resolver from the LiteLLM sheet. Pass the models you're about to price: an
 *  unknown one we haven't checked yet triggers a single refetch (it may have just
 *  been added upstream); if still missing it's recorded as an absent marker in the
 *  cache and not refetched again until the weekly TTL brings in a fresh sheet. */
export async function loadPriceResolver(seenModels?: Iterable<string | undefined>): Promise<PriceResolver> {
  const resolver = seenModels ? await refreshForUnknown(seenModels) : await ensureLoaded();
  return resolver.price;
}
