import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Model prices are sourced from LiteLLM's community-maintained price sheet, so
// we don't hand-maintain a table. The file is fetched once and cached on disk;
// a model not listed there yields cost = null (we never guess a price).
const LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_DIR = join(homedir(), ".cache", "agtail");
const CACHE_FILE = join(CACHE_DIR, "litellm_prices.json");
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // refetch weekly

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

async function loadRawPrices(): Promise<Record<string, LiteLLMEntry> | null> {
  // Fresh cache → use without touching the network.
  if (existsSync(CACHE_FILE)) {
    try {
      const age = Date.now() - (await stat(CACHE_FILE)).mtimeMs;
      if (age < TTL_MS) return JSON.parse(await readFile(CACHE_FILE, "utf-8"));
    } catch {
      /* corrupt cache → refetch */
    }
  }
  try {
    const res = await fetch(LITELLM_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, text);
    return JSON.parse(text);
  } catch (err) {
    // Offline: a stale cache is still real pricing; use it rather than nothing.
    if (existsSync(CACHE_FILE)) {
      try {
        return JSON.parse(await readFile(CACHE_FILE, "utf-8"));
      } catch {
        /* fall through */
      }
    }
    console.error(
      `agtail: could not load LiteLLM prices (${err instanceof Error ? err.message : String(err)}); costs will show as unknown.`,
    );
    return null;
  }
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

/** Build a resolver from the LiteLLM sheet. Matches by exact id, the part after
 *  a provider "/", and with a trailing -YYYYMMDD date stripped (same model). */
export async function loadPriceResolver(): Promise<PriceResolver> {
  const raw = await loadRawPrices();
  if (!raw) return () => null;

  const index = new Map<string, LiteLLMEntry>();
  const add = (key: string, e: LiteLLMEntry) => {
    const k = key.toLowerCase();
    if (!index.has(k)) index.set(k, e);
    if (!index.has(stripDate(k))) index.set(stripDate(k), e);
  };
  for (const [key, entry] of Object.entries(raw)) {
    add(key, entry);
    const slash = key.lastIndexOf("/");
    if (slash >= 0) add(key.slice(slash + 1), entry);
  }

  return (model) => {
    if (!model) return null;
    const m = model.toLowerCase();
    const entry = index.get(m) ?? index.get(stripDate(m));
    return entry ? toPrice(entry) : null;
  };
}
