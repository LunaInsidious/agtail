// Browser shim for node:fs/promises — see ./fs.ts. Unreachable in the playground.
const unavailable =
  (name: string) =>
  (..._args: unknown[]): never => {
    throw new Error(`node:fs/promises.${name} is not available in the browser playground`);
  };

export const mkdir = unavailable("mkdir");
export const readFile = unavailable("readFile");
export const writeFile = unavailable("writeFile");
export const stat = unavailable("stat");
export const readdir = unavailable("readdir");
