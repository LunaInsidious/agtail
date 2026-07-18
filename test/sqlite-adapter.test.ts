import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { sqliteAdapter } from "../src/core/adapters/sqlite-adapter.js";
import type { SqliteReader } from "../src/core/adapters/sqlite-adapter.js";
import type { Event, Session, SessionMeta } from "../src/core/types.js";
import { isRecord } from "../src/core/utils.js";

const dbPath = join(tmpdir(), `agtail-sqlite-test-${process.pid}.db`);
const str = (v: unknown) => (typeof v === "string" ? v : "");

beforeAll(() => {
  const db = new DatabaseSync(dbPath);
  db.exec("create table sessions(id text primary key, title text, cwd text, model text)");
  db.exec("create table messages(session_id text, role text, text text, ts text)");
  const s = db.prepare("insert into sessions values(?,?,?,?)");
  s.run("s1", "build the app", "/proj/app", "gpt-x");
  s.run("s2", "fix the bug", "/proj/app", "gpt-x");
  const m = db.prepare("insert into messages values(?,?,?,?)");
  m.run("s1", "user", "build the app", "2026-07-02T10:00:00Z");
  m.run("s1", "assistant", "done", "2026-07-02T10:00:05Z");
  m.run("s2", "user", "fix the bug", "2026-07-01T09:00:00Z");
  db.close();
});

afterAll(() => rmSync(dbPath, { force: true }));

const listSessions = (db: SqliteReader): SessionMeta[] =>
  db
    .prepare("select id, title, cwd, model from sessions")
    .all()
    .flatMap((r) =>
      isRecord(r)
        ? [
            {
              agent: "demo-db",
              id: str(r.id),
              path: "",
              title: str(r.title),
              cwd: str(r.cwd),
              model: str(r.model),
              messages: 0,
              mtime: 0,
            },
          ]
        : [],
    );

const readSession = (db: SqliteReader, id: string): Session => {
  const head = db.prepare("select id, title, cwd, model from sessions where id=?").get(id);
  const rows = db.prepare("select role, text, ts from messages where session_id=?").all(id);
  const events: Event[] = rows.flatMap((r) =>
    isRecord(r) ? [{ kind: "text", role: str(r.role), text: str(r.text), ts: str(r.ts) }] : [],
  );
  return {
    agent: "demo-db",
    id,
    path: `${dbPath}#${id}`,
    title: isRecord(head) ? str(head.title) : "",
    cwd: isRecord(head) ? str(head.cwd) : undefined,
    model: isRecord(head) ? str(head.model) : undefined,
    messages: events.length,
    mtime: 0,
    events,
  };
};

describe("sqliteAdapter", () => {
  it("lists sessions from DB rows with synthetic paths", async () => {
    const a = sqliteAdapter({ agent: "demo-db", db: dbPath, listSessions, readSession });
    const metas = await a.findSessions();
    expect(metas.map((m) => m.id).sort()).toEqual(["s1", "s2"]);
    const s1 = metas.find((m) => m.id === "s1");
    if (!s1) throw new Error("s1 not found");
    expect(s1.path).toBe(`${dbPath}#s1`);
    expect(s1.cwd).toBe("/proj/app");
  });

  it("reads one session by resolving its synthetic path", async () => {
    const a = sqliteAdapter({ agent: "demo-db", db: dbPath, listSessions, readSession });
    const metas = await a.findSessions();
    const s1 = metas.find((m) => m.id === "s1");
    if (!s1) throw new Error("s1 not found");
    const sess = await a.readSession(s1.path);
    expect(sess.title).toBe("build the app");
    expect(sess.events.map((e) => e.text)).toEqual(["build the app", "done"]);
  });

  it("tolerates a missing DB (findSessions → [])", async () => {
    const a = sqliteAdapter({ agent: "demo-db", db: join(tmpdir(), "nope-xyz.db"), listSessions, readSession });
    expect(await a.findSessions()).toEqual([]);
    expect(a.roots()).toEqual([]);
  });
});
