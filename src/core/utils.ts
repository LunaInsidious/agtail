// Domain-agnostic primitives shared across core. Keep this strictly generic —
// anything that encodes a Claude/Codex/transcript convention belongs in a domain
// module (e.g. adapters/utils.ts), not here.

// --- lenient coercion of `unknown` parsed from JSON ---------------------------
// A missing or wrong-typed value degrades to "" / {} rather than throwing, so one
// malformed line never aborts a whole parse. (Type guard, not a cast — no `as`.)

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function obj(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

// --- async iteration ----------------------------------------------------------

// Drain an async iterable into an array (no pure built-in until Array.fromAsync,
// which needs a newer lib target).
export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const arr: T[] = [];
  for await (const x of it) arr.push(x);
  return arr;
}
