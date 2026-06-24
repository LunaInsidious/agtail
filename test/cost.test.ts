import { describe, expect, it } from "vitest";
import { aggregateUsage } from "../src/core/cost.js";
import type { PriceResolver } from "../src/core/pricing.js";
import type { Event } from "../src/core/types.js";

// In-memory resolver so tests never hit the network.
const resolve: PriceResolver = (m) =>
  m && m.includes("sonnet") ? { input: 3, output: 15 } : null;

describe("cost aggregation", () => {
  it("returns null cost when a model is unpriced (no guessing)", () => {
    const events: Event[] = [
      { kind: "text", model: "gpt-5.5", usage: { inputTokens: 100, outputTokens: 10 } },
    ];
    const u = aggregateUsage(events, resolve);
    expect(u.inputTokens).toBe(100);
    expect(u.costUsd).toBeNull();
    expect(u.unpricedModels).toContain("gpt-5.5");
  });

  it("prices a model the resolver knows", () => {
    const events: Event[] = [
      { kind: "text", model: "claude-sonnet-4-6", usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    ];
    const u = aggregateUsage(events, resolve);
    expect(u.costUsd).toBeCloseTo(3, 5); // $3 / 1M input
  });
});
