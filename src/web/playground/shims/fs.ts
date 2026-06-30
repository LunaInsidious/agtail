// Browser shim for node:fs. The playground bundles the fs adapters' parsing code
// (buildClaudeSession/buildCodexSession) but never their file-reading paths, so
// these are unreachable — they throw loudly rather than degrade silently.
const unavailable =
  (name: string) =>
  (..._args: unknown[]): never => {
    throw new Error(`node:fs.${name} is not available in the browser playground`);
  };

export const createReadStream = unavailable("createReadStream");
export const existsSync = unavailable("existsSync");
export const readdirSync = unavailable("readdirSync");
export const readFileSync = unavailable("readFileSync");
