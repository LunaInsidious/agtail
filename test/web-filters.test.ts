import { describe, it, expect } from "vitest";
import type { Filters } from "../src/web/api.js";
import { defaultSavedName, filterChips, savedChips, uniqueName } from "../src/web/filters.js";

const base: Filters = {
  q: "",
  agents: [],
  tools: [],
  models: [],
  cwds: [],
  since: "",
  until: "",
  kinds: [],
  mask: false,
  archived: "all",
  programmatic: "all",
};
const f = (o: Partial<Filters>): Filters => ({ ...base, ...o });

describe("filterChips", () => {
  it("emits one chip per condition and excludes the query", () => {
    const labels = filterChips(f({ q: "hi", agents: ["codex"], models: ["opus"], cwds: ["/Users/x/proj"], mask: true })).map(
      (c) => c.label,
    );
    expect(labels).toEqual(["codex", "✦ opus", "📁 ~/proj", "🔒 mask"]); // homeShort + no q
  });

  it("reflects the archived / programmatic tri-states", () => {
    const has = (o: Partial<Filters>, label: string) => filterChips(f(o)).some((c) => c.label === label);
    expect(has({ archived: "only" }, "🗄 archived")).toBe(true);
    expect(has({ archived: "none" }, "active only")).toBe(true);
    expect(has({ programmatic: "only" }, "🤖 programmatic")).toBe(true);
    expect(has({ programmatic: "none" }, "interactive only")).toBe(true);
  });
});

describe("savedChips", () => {
  it("prepends the query chip", () => {
    expect(savedChips(f({ q: "blogsync", models: ["opus"] }))[0]!.label).toBe('🔎 "blogsync"');
  });
});

describe("defaultSavedName", () => {
  it("falls back when nothing is set", () => {
    expect(defaultSavedName(base)).toBe("Saved search");
  });
  it("uses the single condition's label", () => {
    expect(defaultSavedName(f({ agents: ["codex"] }))).toBe("codex");
  });
  it("shows the first two conditions then +N (so different searches don't collide)", () => {
    expect(defaultSavedName(f({ q: "x", agents: ["codex"], models: ["opus"] }))).toBe('🔎 "x" · codex +1');
  });
});

describe("uniqueName", () => {
  it("returns the base name when free", () => {
    expect(uniqueName("audit", ["other"])).toBe("audit");
  });
  it("appends (2), (3)… on collision", () => {
    expect(uniqueName("audit", ["audit"])).toBe("audit (2)");
    expect(uniqueName("audit", ["audit", "audit (2)"])).toBe("audit (3)");
  });
});
