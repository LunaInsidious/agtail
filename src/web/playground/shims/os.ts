// Browser shim for node:os. homedir is referenced by path-building helpers that
// the playground never invokes; a constant keeps it harmless if a path is ever
// constructed (no real home directory exists in the browser).
export const homedir = (): string => "/home/playground";
