import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { isRecord } from "./utils.js";

/** Parse one JSONL line into a record, or null if it's broken/non-object. */
function parseLine(trimmed: string): Record<string, unknown> | null {
  try {
    const obj: unknown = JSON.parse(trimmed);
    return isRecord(obj) ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Stream a JSONL file line by line, yielding parsed objects. Broken lines are
 * skipped silently — transcripts are tool-owned data and a single corrupt line
 * should never abort reading the rest of a session.
 */
export async function* iterJsonl(path: string): AsyncGenerator<Record<string, unknown>> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const obj = parseLine(trimmed);
    if (obj) yield obj;
  }
}
