import type { Price, PriceResolver } from "../../core/pricing.js";

// The playground can't fetch LiteLLM (no server), so it bundles the REAL LiteLLM
// prices (per-million tokens) for exactly the models the sample dataset uses —
// no fabricated numbers. A model not listed here resolves to null, so cost shows
// "unknown" just like the real app would for an unpriced model.
const PRICES: Record<string, Price> = {
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "gpt-5.5": { input: 5, output: 30, cacheRead: 0.5 },
};

export const playgroundPrices: PriceResolver = (model) => (model ? (PRICES[model] ?? null) : null);
