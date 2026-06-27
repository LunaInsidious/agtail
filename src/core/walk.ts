import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Expand a leading ~ to the home directory. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Read a directory's entries, or [] if it can't be read (missing/permission). */
async function readEntries(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Recursively collect files matching a predicate. Missing dirs yield []. */
export async function walkFiles(root: string, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string) {
    for (const e of await readEntries(dir)) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await recurse(full);
      else if (e.isFile() && match(e.name)) out.push(full);
    }
  }
  if (existsSync(root)) await recurse(root);
  return out;
}

export async function mtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}
