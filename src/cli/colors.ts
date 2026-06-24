const CODES: Record<string, string> = {
  dim: "\x1b[2m",
  rst: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  amber: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  violet: "\x1b[35m",
  gray: "\x1b[90m",
};

const enabled = process.stdout.isTTY && !process.env.NO_COLOR;

export function color(s: string, c: keyof typeof CODES, on = enabled): string {
  return on ? `${CODES[c]}${s}${CODES.rst}` : s;
}

/** mm-dd HH:MM:SS in local time from an ISO timestamp. */
export function shortTs(ts?: string): string {
  if (!ts) return "        ";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts.slice(0, 19);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
