import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

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
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj && typeof obj === "object") {
      yield obj as Record<string, unknown>;
    }
  }
}
