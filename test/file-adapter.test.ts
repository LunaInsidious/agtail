import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSession, fileAdapter } from "../src/core/adapters/file-adapter.js";
import type { Event, Session } from "../src/core/types.js";
import { isRecord } from "../src/core/utils.js";

const dir = (p: string) => fileURLToPath(new URL(`./fixtures/file-adapter/${p}`, import.meta.url));
const str = (v: unknown) => (typeof v === "string" ? v : "");
const toTextEvents = (arr: unknown): Event[] =>
  (Array.isArray(arr) ? arr : []).flatMap((e) =>
    isRecord(e) ? [{ kind: "text", role: str(e.role), text: str(e.text) }] : [],
  );

// A trivial JSONL parse: role/text records → text events.
const parse = (lines: Record<string, unknown>[], ctx: { id: string; path: string; mtime: number }): Session => {
  const first = lines[0];
  return {
    agent: "demo",
    id: ctx.id,
    path: ctx.path,
    mtime: ctx.mtime,
    title: first && typeof first.text === "string" ? first.text : "",
    messages: lines.length,
    events: toTextEvents(lines),
  };
};

describe("buildSession", () => {
  it("derives title/started/ended/models/messages from events", () => {
    const events: Event[] = [
      { kind: "text", role: "user", ts: "2026-07-02T10:00:00Z", text: "do the thing\nmore" },
      { kind: "tool_use", ts: "2026-07-02T10:00:01Z", tool: "Bash", input: { command: "ls" } },
      { kind: "text", role: "assistant", ts: "2026-07-02T10:00:05Z", text: "done", model: "m-1" },
    ];
    const sess = buildSession({ id: "s1", path: "p", mtime: 7 }, events, { agent: "acme", cwd: "/proj" });
    expect(sess.title).toBe("do the thing"); // first user line
    expect(sess.started).toBe("2026-07-02T10:00:00Z");
    expect(sess.ended).toBe("2026-07-02T10:00:05Z");
    expect(sess.models).toEqual(["m-1"]);
    expect(sess.model).toBe("m-1");
    expect(sess.messages).toBe(3);
    expect(sess.cwd).toBe("/proj");
    expect(sess.id).toBe("s1");
  });

  it("falls back to '(no prompt)' and lets fileAdapter fill agent", () => {
    const sess = buildSession({ id: "s", path: "p", mtime: 0 }, []);
    expect(sess.title).toBe("(no prompt)");
    expect(sess.agent).toBe(""); // fileAdapter defaults this to cfg.agent
    expect(sess.messages).toBe(0);
  });
});

describe("fileAdapter — unit:file, JSONL (parse)", () => {
  it("discovers and parses one-JSONL-per-session under root", async () => {
    const a = fileAdapter({
      agent: "demo",
      root: dir("active"),
      match: (n) => n.endsWith(".jsonl"),
      parse,
      importStore: false,
    });
    const metas = await a.findSessions();
    expect(metas.map((m) => m.id)).toContain("s1");
    const s1 = metas.find((m) => m.id === "s1");
    if (!s1) throw new Error("s1 not found");
    expect(s1.archived).toBeUndefined();

    const sess = await a.readSession(s1.path);
    expect(sess.title).toBe("hello");
    expect(sess.events.map((e) => e.text)).toEqual(["hello", "hi"]);
  });

  it("tags sessions found under archivedRoot", async () => {
    const a = fileAdapter({
      agent: "demo",
      root: dir("active"),
      archivedRoot: dir("archived"),
      match: (n) => n.endsWith(".jsonl"),
      parse,
      importStore: false,
    });
    const metas = await a.findSessions();
    expect(metas.find((m) => m.id === "s1")?.archived).toBeUndefined();
    expect(metas.find((m) => m.id === "s2")?.archived).toBe(true);
    expect(a.roots()).toEqual([dir("active"), dir("archived")]);
  });

  it("transferFiles returns the native transcript files", async () => {
    const a = fileAdapter({
      agent: "demo",
      root: dir("active"),
      match: (n) => n.endsWith(".jsonl"),
      parse,
      importStore: false,
    });
    const files = await a.transferFiles();
    expect(files.some((f) => f.endsWith("s1.jsonl"))).toBe(true);
  });
});

describe("fileAdapter — unit:file, whole-JSON (parseJson)", () => {
  it("reads one JSON object per session", async () => {
    const a = fileAdapter({
      agent: "demo",
      root: dir("json"),
      match: (n) => n.endsWith(".json"),
      importStore: false,
      parseJson: (data, ctx) => {
        const o = isRecord(data) ? data : {};
        return {
          agent: "demo",
          id: str(o.id) || ctx.id,
          path: ctx.path,
          mtime: ctx.mtime,
          title: str(o.title),
          cwd: str(o.cwd) || undefined,
          messages: Array.isArray(o.events) ? o.events.length : 0,
          events: toTextEvents(o.events),
        };
      },
    });
    const metas = await a.findSessions();
    const c1 = metas.find((m) => m.id === "c1");
    if (!c1) throw new Error("c1 not found");
    expect(c1.cwd).toBe("/proj");
    const sess = await a.readSession(c1.path);
    expect(sess.events.map((e) => e.text)).toEqual(["hi", "yo"]);
  });
});

describe("fileAdapter — unit:dir (read)", () => {
  it("treats each subdirectory as a session", async () => {
    const a = fileAdapter({
      agent: "demo",
      root: dir("tasks"),
      unit: "dir",
      importStore: false,
      read: async (path, ctx) => {
        const arr: unknown = JSON.parse(await readFile(join(path, "conv.json"), "utf-8"));
        const events = toTextEvents(arr);
        return {
          agent: "demo",
          id: ctx.id,
          path: ctx.path,
          mtime: ctx.mtime,
          title: "task",
          messages: events.length,
          events,
        };
      },
    });
    const metas = await a.findSessions();
    expect(metas.map((m) => m.id)).toContain("task-1");
    const t = metas.find((m) => m.id === "task-1");
    if (!t) throw new Error("task-1 not found");
    const sess = await a.readSession(t.path);
    expect(sess.events.map((e) => e.text)).toEqual(["do X", "done"]);
  });
});

describe("fileAdapter — misconfiguration fails loud", () => {
  const stub = (): Session => ({ agent: "x", id: "s", path: "p", title: "t", messages: 0, mtime: 0, events: [] });

  it("rejects more than one read mode", () => {
    expect(() =>
      fileAdapter({ agent: "x", root: "/t", match: () => true, parse: () => stub(), parseJson: () => stub() }),
    ).toThrow(/exactly one/);
  });

  it("requires match for unit:file", () => {
    expect(() => fileAdapter({ agent: "x", root: "/t", parse: () => stub() })).toThrow(/required/);
  });

  it("rejects parse with unit:dir", () => {
    expect(() => fileAdapter({ agent: "x", root: "/t", unit: "dir", parse: () => stub() })).toThrow(/unit "dir"/);
  });
});
