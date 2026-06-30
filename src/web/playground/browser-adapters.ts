import type { Agent, Session, SessionMeta } from "../../core/types.js";
import type { Adapter } from "../../core/adapters/index.js";
import { registerAdapters } from "../../core/adapters/index.js";
import { allSessions, findByPath, nativeFiles } from "./data.js";

// In-memory adapters over the bundled sample + imported store. They satisfy the
// same Adapter contract as the fs ones, so the existing search/listing engine
// runs unchanged in the browser (the adapters are injected via registerAdapters).

const toMeta = (s: Session): SessionMeta => {
  const { events: _events, ...meta } = s;
  return meta;
};

function browserAdapter(agent: Agent): Adapter {
  return {
    agent,
    base: `playground:/${agent}`,
    roots: () => [],
    findSessions: () =>
      Promise.resolve(
        allSessions()
          .filter((s) => s.agent === agent)
          .map(toMeta),
      ),
    readSession: (path) => {
      const s = findByPath(path);
      if (!s) throw new Error(`session not found: ${path}`);
      return Promise.resolve(s);
    },
    transferFiles: () => Promise.resolve(nativeFiles.filter((f) => f.agent === agent).map((f) => f.path)),
  };
}

/** Wire the in-memory adapters into core's registry (call once at startup). */
export function registerPlaygroundAdapters(): void {
  registerAdapters(() => [browserAdapter("claude-code"), browserAdapter("codex")]);
}
