import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Event } from "../lib/api.js";
import { isRecord, pretty } from "../lib/util.js";

// Searchable text for one event (in-session find).
export function eventText(e: Event): string {
  const parts = [e.text ?? "", e.tool ?? "", summarizeInput(e.tool, e.input), e.result?.text ?? ""];
  if (e.raw)
    try {
      parts.push(JSON.stringify(e.raw));
    } catch {
      /* ignore */
    }
  return parts.join(" ");
}

// Escape a string for safe use as a literal RegExp source.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Split text and wrap occurrences of `term` (case-insensitive) in <mark>.
function Highlighted({ text, term }: { text: string; term?: string }) {
  if (!term) return <>{text}</>;
  const matches = [...text.matchAll(new RegExp(escapeRe(term), "gi"))];
  // Build alternating plain/marked segments from the match positions; `cursor`
  // tracks where the previous match ended (mutating a const field, not a `let`).
  const cursor = { at: 0 };
  const out = matches.flatMap((m) => {
    const j = m.index;
    const before = j > cursor.at ? [text.slice(cursor.at, j)] : [];
    const marked = <mark key={j}>{m[0]}</mark>;
    cursor.at = j + m[0].length;
    return [...before, marked];
  });
  return (
    <>
      {out}
      {text.slice(cursor.at)}
    </>
  );
}

const COLLAPSE_LEN = 600;

// Per-turn token/cost for an assistant message (or the turn that emitted a tool).
function UsageBadge({ e }: { e: Event }) {
  if (e.tokens == null) return null;
  return (
    <span className="usage" title={e.model ?? ""}>
      {e.tokens.toLocaleString()} tok{e.cost != null ? ` · $${e.cost.toFixed(4)}` : " · cost unknown"}
    </span>
  );
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- event renderer: a switch over event kinds (text/tool/thinking/hook/system…).
export const EventRow = memo(function EventRow({ e, highlight }: { e: Event; highlight?: string }) {
  if (e.kind === "tool_use") {
    return (
      <div className="ev tool">
        <div className="sig">⚙</div>
        <div className="body">
          <UsageBadge e={e} />
          <ToolHead e={e} highlight={highlight} />
        </div>
      </div>
    );
  }
  if (e.kind === "text") {
    // In a sidechain, role "user" is the parent agent's instruction, not the human.
    const human = e.role === "user" && !e.sidechain;
    const parentAgent = e.role === "user" && e.sidechain;
    const cls = human ? "user" : parentAgent ? "agentinstr" : "assistant";
    const label = parentAgent ? "agent" : e.role;
    return (
      <div className={"ev " + cls}>
        <div className="sig">{human ? "▸" : parentAgent ? "↳" : "◂"}</div>
        <div className="body">
          <UsageBadge e={e} />
          <span className="role">{label}</span>
          <Collapsible text={e.text ?? ""} markdown highlight={highlight} />
        </div>
      </div>
    );
  }
  if (e.kind === "thinking") {
    return (
      <div className="ev think">
        <div className="sig">∴</div>
        <div className="body">
          <Collapsible text={e.text ?? ""} collapsed highlight={highlight} />
        </div>
      </div>
    );
  }
  if (e.kind === "hook") return <HookRow e={e} highlight={highlight} />;
  if (e.kind === "unknown") {
    // Don't force-collapse: short raw shows inline, "Show all" only when long.
    return (
      <div className="ev unknown">
        <div className="sig">?</div>
        <div className="body">
          <span className="role">unknown · {e.text}</span>
          <Collapsible text={pretty(e.raw)} highlight={highlight} />
        </div>
      </div>
    );
  }
  const sig = e.kind === "summary" ? "—" : "○";
  return (
    <div className={"ev " + e.kind}>
      <div className="sig">{sig}</div>
      <div className="body">
        <Collapsible text={e.text ?? ""} highlight={highlight} />
      </div>
    </div>
  );
});

function ToolHead({ e, highlight }: { e: Event; highlight?: string }) {
  const summary = summarizeInput(e.tool, e.input);
  // When the in-session search matches input/result, default the detail open —
  // but leave it user-toggleable (don't force it).
  const inputStr = pretty(e.input);
  const resultStr = e.result?.text ?? "";
  const matchesDetail =
    !!highlight &&
    (inputStr.toLowerCase().includes(highlight.toLowerCase()) ||
      resultStr.toLowerCase().includes(highlight.toLowerCase()));
  const [open, setOpen] = useState(matchesDetail);
  useEffect(() => setOpen(matchesDetail), [matchesDetail]);
  return (
    <>
      <div className={"toolhead" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        {e.result && <span className={"rc " + (e.result.isError ? "err" : "ok")}>{e.result.isError ? "✗" : "✓"}</span>}
        <span className="name">
          <Highlighted text={e.tool ?? ""} term={highlight} />
        </span>
        <span className="sum">
          <Highlighted text={summary} term={highlight} />
        </span>
      </div>
      {open && (
        <div className="detail">
          <div className="seg">
            <div className="lbl">input</div>
            <pre>
              <Highlighted text={inputStr} term={highlight} />
            </pre>
          </div>
          {e.result && (
            <div className="seg">
              <div className="lbl">result{e.result.isError ? " · error" : ""}</div>
              <pre className={e.result.isError ? "err" : ""}>
                <Highlighted text={resultStr} term={highlight} />
              </pre>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Hook firing: a collapsed command-only line by default; click to reveal the
// full raw record. Mirrors the tool row's expand pattern (caret + detail).
function HookRow({ e, highlight }: { e: Event; highlight?: string }) {
  const rawStr = pretty(e.raw);
  const matchesDetail = !!highlight && rawStr.toLowerCase().includes(highlight.toLowerCase());
  const [open, setOpen] = useState(matchesDetail);
  useEffect(() => setOpen(matchesDetail), [matchesDetail]);
  return (
    <div className="ev hook">
      <div className="sig">🪝</div>
      <div className="body">
        <div className={"toolhead" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)}>
          <span className="caret">{open ? "▾" : "▸"}</span>
          <span className="role">{e.hookEvent ?? "hook"}</span>
          {e.plugin && (
            <span className="hookplugin" title={`from the ${e.plugin} plugin`}>
              🧩 {e.plugin}
            </span>
          )}
          {e.tool && (
            <span className="hooktool" title={`triggered by ${e.tool}`}>
              🔧 {e.tool}
            </span>
          )}
          <span className="sum">
            <Highlighted text={e.text ?? ""} term={highlight} />
          </span>
        </div>
        {open && (
          <div className="detail">
            <div className="seg">
              <pre>
                <Highlighted text={rawStr} term={highlight} />
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Collapsible({
  text,
  markdown,
  collapsed,
  highlight,
}: {
  text: string;
  markdown?: boolean;
  collapsed?: boolean;
  highlight?: string;
}) {
  const heavy = collapsed || text.length > COLLAPSE_LEN;
  // Highlight match defaults the block open (but stays user-toggleable).
  const matches = !!highlight && text.toLowerCase().includes(highlight.toLowerCase());
  const [open, setOpen] = useState(!heavy || matches);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new find match should re-open; `heavy` is derived from props and must not clobber a user toggle.
  useEffect(() => setOpen(!heavy || matches), [matches]);
  if (!text) return null;

  const moreBtn = heavy && (
    <button className="more" onClick={() => setOpen((o) => !o)}>
      {open ? "▲ Collapse" : `▼ Show all (${text.length.toLocaleString()} chars)`}
    </button>
  );

  // Prose: always render Markdown (clamp height when collapsed) so formatting
  // is consistent. While searching, fall back to plain text + <mark> so matches
  // stay visible.
  if (markdown && !highlight) {
    return (
      <div className="prose">
        <div className={"md" + (open ? "" : " clamp")}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
        {moreBtn}
      </div>
    );
  }

  // Raw text / code / JSON, or search mode: char-slice + optional highlight.
  const shown = open ? text : text.slice(0, COLLAPSE_LEN);
  return (
    <div className={"prose" + (open ? "" : " clipped")}>
      <span className="raw">
        <Highlighted text={shown} term={highlight} />
      </span>
      {moreBtn}
    </div>
  );
}

// Mirror of core/format.ts summarizeInput for the browser.
function summarizeInput(tool: string | undefined, input: unknown): string {
  if (!isRecord(input)) return String(input ?? "");
  const i = input;
  const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  switch (tool) {
    case "Bash": {
      const cmd = s(i.command).replace(/\n/g, " ");
      return i.description ? `${cmd}   « ${s(i.description)}` : cmd;
    }
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
    case "Read":
      return s(i.file_path) || s(i.notebook_path);
    case "WebFetch":
      return s(i.url);
    case "WebSearch":
      return s(i.query);
    case "exec":
      return s(i.command);
    default:
      try {
        return JSON.stringify(i).slice(0, 300);
      } catch {
        return "";
      }
  }
}
