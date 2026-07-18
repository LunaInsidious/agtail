// Helpers shared across the session adapters (Claude Code, Codex).

import type { Session } from "../types.js";

// A session title is the first line of the first user prompt, capped so the
// session list stays scannable.
export function firstLine(text: string, max = 120): string {
  return (text.split("\n")[0] ?? "").slice(0, max);
}

/** Attach transcript-integrity signals to a session, but only when non-clean, so
 *  a clean read leaves the fields unset (absence === clean). Called by adapters
 *  right after building a Session from {@link collectJsonl} stats. */
export function tagIntegrity(sess: Session, stats: { malformed: number; truncated: boolean }): void {
  if (stats.malformed > 0) sess.malformedLines = stats.malformed;
  if (stats.truncated) sess.truncated = true;
}
