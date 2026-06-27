// Secret masking, ported from claude-transcript.py. Off by default; opt-in via
// --mask so the original transcript is shown verbatim unless the user asks.

const REDACTED = "<redacted>";

const KV_PATTERN =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWD|PASSWORD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[A-Z0-9_]*)(\s*[=:]\s*)('[^']*'|"[^"]*"|\S+)/gi;

const AUTH_PATTERN = /(authorization\s*[=:]\s*)(?:bearer\s+|basic\s+)?\S+/gi;

const TOKEN_PATTERNS: RegExp[] = [
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bgho_[A-Za-z0-9]{20,}\b/g,
  /\bsk-[A-Za-z0-9-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]+?-----END[^-]*PRIVATE KEY-----/g,
];

export function mask(text: string, enabled = true): string {
  if (!enabled || typeof text !== "string") return text;
  const kvMasked = text
    .replace(KV_PATTERN, (_m, k, sep) => `${k}${sep}${REDACTED}`)
    .replace(AUTH_PATTERN, (_m, k) => `${k}${REDACTED}`);
  return TOKEN_PATTERNS.reduce((acc, pat) => acc.replace(pat, REDACTED), kvMasked);
}

/** Deep-mask strings inside an arbitrary JSON-like value. */
export function maskValue(value: unknown, enabled = true): unknown {
  if (!enabled) return value;
  if (typeof value === "string") return mask(value, true);
  if (Array.isArray(value)) return value.map((v) => maskValue(v, true));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskValue(v, true);
    return out;
  }
  return value;
}
