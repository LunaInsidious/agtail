import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { codexAdapter } from "../src/core/adapters/codex.js";
import { matchArchived } from "../src/core/types.js";

// A Codex CODEX_HOME laid out with both sessions/ and the sibling
// archived_sessions/. The adapter root points at sessions/; archived ones are
// discovered as a sibling and tagged by path.
const sessionsRoot = fileURLToPath(new URL("./fixtures/codex-home/sessions", import.meta.url));
const archivedFile = fileURLToPath(
  new URL("./fixtures/codex-home/archived_sessions/2026/06/20/rollout-archived.jsonl", import.meta.url),
);

describe("matchArchived", () => {
  it("defaults to including everything", () => {
    expect(matchArchived({ archived: true })).toBe(true);
    expect(matchArchived({ archived: false }, "all")).toBe(true);
  });
  it("only => keep archived; none => drop archived", () => {
    expect(matchArchived({ archived: true }, "only")).toBe(true);
    expect(matchArchived({ archived: false }, "only")).toBe(false);
    expect(matchArchived({ archived: true }, "none")).toBe(false);
    expect(matchArchived({ archived: false }, "none")).toBe(true);
  });
});

describe("codex adapter archived discovery", () => {
  it("scans both sessions/ and the sibling archived_sessions/ and tags archived ones", async () => {
    const metas = await codexAdapter(sessionsRoot).findSessions();
    const byId = new Map(metas.map((m) => [m.id, m]));
    expect(byId.get("active-0001")?.archived).toBeFalsy();
    expect(byId.get("archived-0001")?.archived).toBe(true);
  });

  it("tags archived on a direct read (resolveSession path)", async () => {
    const sess = await codexAdapter(sessionsRoot).readSession(archivedFile);
    expect(sess.archived).toBe(true);
  });
});
