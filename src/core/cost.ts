import type { Event, Usage } from "./types.js";
import type { Price, PriceResolver } from "./pricing.js";

// Prices come from LiteLLM via a PriceResolver (see pricing.ts). cost.ts only
// does the arithmetic; an unresolved model yields null (never a guessed price).

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  /** USD, or null when any contributing model has no known price. */
  costUsd: number | null;
  /** model ids seen that had no price entry (so the UI can say which). */
  unpricedModels: string[];
}

function addUsage(acc: UsageTotals, u: Usage) {
  acc.inputTokens += u.inputTokens ?? 0;
  acc.outputTokens += u.outputTokens ?? 0;
  acc.cacheReadTokens += u.cacheReadTokens ?? 0;
  acc.cacheCreationTokens += u.cacheCreationTokens ?? 0;
}

function costOf(u: Usage, p: Price): number {
  const M = 1_000_000;
  return (
    ((u.inputTokens ?? 0) * p.input +
      (u.outputTokens ?? 0) * p.output +
      (u.cacheReadTokens ?? 0) * (p.cacheRead ?? p.input) +
      (u.cacheCreationTokens ?? 0) * (p.cacheWrite ?? p.input)) /
    M
  );
}

/** Total tokens for one usage record. */
export function usageSum(u: Usage): number {
  return (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheCreationTokens ?? 0);
}

/** USD cost of one usage record, or null if the model has no known price. */
export function costForModel(u: Usage, model: string | undefined, resolve: PriceResolver): number | null {
  const p = resolve(model);
  return p ? costOf(u, p) : null;
}

/** Aggregate token usage + cost across a session's events. */
export function aggregateUsage(events: Event[], resolve: PriceResolver): UsageTotals {
  const totals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    unpricedModels: [],
  };
  const unpriced = new Set<string>();
  let cost = 0;
  let anyPriced = false;

  for (const e of events) {
    if (!e.usage) continue;
    addUsage(totals, e.usage);
    const p = resolve(e.model);
    if (p) {
      cost += costOf(e.usage, p);
      anyPriced = true;
    } else if (e.model) {
      unpriced.add(e.model);
    }
  }

  totals.totalTokens = totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens;
  totals.unpricedModels = [...unpriced];
  // If any contributing model was unpriced, the total is incomplete -> null.
  totals.costUsd = unpriced.size > 0 ? null : anyPriced ? cost : null;
  return totals;
}
