import type { Agent } from "./types.js";
import { isAgent } from "./types.js";
import { isRecord } from "./utils.js";

// The portable export bundle shape + its validator. Kept fs-free (separate from
// transfer.ts) so the browser playground can build and validate bundles too.

// A portable bundle of raw transcripts: enough to rehydrate sessions on another
// machine. Files carry their content inline plus a base-relative path so import
// can place them either back into the native agent dirs or the agtail store.
export interface Bundle {
  agtailExport: 1;
  created: string;
  files: { agent: Agent; rel: string; content: string }[];
}

/** Validate untrusted bundle JSON, throwing a clear Error on any shape mismatch
 *  so callers can surface it rather than writing garbage to disk. */
export function assertBundle(value: unknown): asserts value is Bundle {
  if (!isRecord(value) || value.agtailExport !== 1) {
    throw new Error("not an agtail export bundle (agtailExport !== 1)");
  }
  if (!Array.isArray(value.files)) throw new Error("bundle.files must be an array");
  for (const f of value.files) {
    if (!isRecord(f) || typeof f.agent !== "string" || typeof f.rel !== "string" || typeof f.content !== "string") {
      throw new Error("bundle.files entries must have string agent/rel/content");
    }
    if (!isAgent(f.agent)) throw new Error(`bundle.files has unknown agent: ${f.agent}`);
  }
}
