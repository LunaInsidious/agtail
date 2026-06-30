// Browser shim for node:readline — see ./fs.ts. Unreachable in the playground.
export const createInterface = (..._args: unknown[]): never => {
  throw new Error("node:readline.createInterface is not available in the browser playground");
};
