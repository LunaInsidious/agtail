import { join } from "node:path";
import { homedir } from "node:os";
import type { Agent } from "./types.js";

// agtail keeps imported (synced-from-another-machine) sessions in its own store,
// outside the native agent dirs, so they never masquerade as local history the
// agent could resume. The store mirrors the native layout under a per-agent root.
//
// Resolved lazily (read at call time, not module load) so a test can point
// XDG_DATA_HOME at a tmp dir without reimporting — same pattern as pricing.ts.
export function importStoreDir(agent: Agent): string {
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "agtail", "imported", agent);
}
