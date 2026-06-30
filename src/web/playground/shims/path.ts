// Browser shim for node:path (posix-only). The playground's runtime path never
// calls these (parsing takes ids/paths as data), but they're given correct
// best-effort implementations so any incidental use behaves sanely.
export const sep = "/";

export const basename = (p: string, ext?: string): string => {
  const b = p.split("/").pop() ?? "";
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
};

export const dirname = (p: string): string => {
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  return i === 0 ? "/" : p.slice(0, i);
};

export const join = (...parts: string[]): string =>
  parts
    .filter(Boolean)
    .join("/")
    .replace(/\/{2,}/g, "/");

export const relative = (_from: string, to: string): string => to;
export const resolve = (...parts: string[]): string => parts.filter(Boolean).join("/");
