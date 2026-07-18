import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { parseLine } from "./jsonl-parse.js";

/** Transcript integrity tally gathered while reading a JSONL file.
 *  `malformed` = non-empty lines that failed to parse (dropped). `truncated` =
 *  the LAST non-empty line failed to parse — a cut-mid-write signal. */
interface JsonlStats {
  malformed: number;
  truncated: boolean;
}

/**
 * Stream a JSONL file line by line, yielding parsed objects. Broken lines are
 * skipped rather than aborting the read — transcripts are tool-owned data and a
 * single corrupt line should never lose the rest of a session. When a `stats`
 * sink is passed, dropped lines are tallied (so callers can surface the loss
 * instead of hiding it): each bad line bumps `malformed` and provisionally marks
 * `truncated`, which a later good line clears — so `truncated` ends true iff the
 * final non-empty line was the broken one.
 */
async function* iterJsonl(path: string, stats?: JsonlStats): AsyncGenerator<Record<string, unknown>> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const obj = parseLine(trimmed);
    if (obj) {
      if (stats) stats.truncated = false; // a good line follows → not the tail
      yield obj;
    } else if (stats) {
      stats.malformed += 1;
      stats.truncated = true; // holds iff this stays the last non-empty line
    }
  }
}

/** Read a whole JSONL file into memory, tallying dropped lines. The normalized
 *  read path for adapters: they materialize the records anyway, and the stats let
 *  a session flag its own transcript integrity (SessionMeta.malformedLines). */
export async function collectJsonl(
  path: string,
): Promise<{ lines: Record<string, unknown>[]; malformed: number; truncated: boolean }> {
  const stats: JsonlStats = { malformed: 0, truncated: false };
  const lines: Record<string, unknown>[] = [];
  for await (const line of iterJsonl(path, stats)) lines.push(line);
  return { lines, malformed: stats.malformed, truncated: stats.truncated };
}
