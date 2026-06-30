import { isRecord } from "./utils.js";

// Pure JSONL parsing, free of node:fs so it can run in the browser too. The
// streaming file reader (jsonl.ts) and the in-memory parser below share parseLine.

/** Parse one JSONL line into a record, or null if it's broken/non-object. */
export function parseLine(trimmed: string): Record<string, unknown> | null {
  try {
    const obj: unknown = JSON.parse(trimmed);
    return isRecord(obj) ? obj : null;
  } catch {
    return null;
  }
}

/** Parse a whole JSONL string into records. Broken/blank lines are skipped
 *  silently — transcripts are tool-owned data; one corrupt line shouldn't abort
 *  the rest (same contract as the streaming reader). */
export function parseJsonlText(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const obj = parseLine(trimmed);
    if (obj) out.push(obj);
  }
  return out;
}
