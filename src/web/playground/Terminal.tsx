import { useEffect, useRef, useState } from "react";
import { runCommand } from "./terminal-run.js";

interface Line {
  role: "in" | "out";
  text: string;
}

const INTRO: Line[] = [
  { role: "out", text: "agtail playground terminal — runs entirely in your browser over fictional sample data." },
  { role: "out", text: "Type 'help' for commands. Try: list · grep rate · show 7c1f2a40 · stats" },
  { role: "out", text: "" },
];

export function Terminal() {
  const [lines, setLines] = useState<Line[]>(INTRO);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Command history for ArrowUp/Down (object fields, not `let`).
  const hist = useRef<{ items: string[]; idx: number }>({ items: [], idx: 0 });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const submit = async () => {
    const cmd = input.trim();
    setInput("");
    if (!cmd) return;
    hist.current.items.push(cmd);
    hist.current.idx = hist.current.items.length;
    setLines((l) => [...l, { role: "in", text: `$ ${cmd}` }]);
    setBusy(true);
    const out = await runCommand(cmd);
    setBusy(false);
    if (out === null) {
      setLines([]);
      return;
    }
    setLines((l) => [...l, ...out.map((text) => ({ role: "out" as const, text }))]);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void submit();
      return;
    }
    const h = hist.current;
    if (e.key === "ArrowUp" && h.items.length) {
      e.preventDefault();
      h.idx = Math.max(0, h.idx - 1);
      setInput(h.items[h.idx] ?? "");
    } else if (e.key === "ArrowDown" && h.items.length) {
      e.preventDefault();
      h.idx = Math.min(h.items.length, h.idx + 1);
      setInput(h.idx === h.items.length ? "" : (h.items[h.idx] ?? ""));
    }
  };

  return (
    <div className="terminal" onClick={() => inputRef.current?.focus()}>
      <div className="termout">
        {lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only console log, indices are stable
          <div key={i} className={`termline ${l.role}`}>
            {l.text || " "}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="termrow">
        <span className="termprompt">{busy ? "…" : "$"}</span>
        <input
          ref={inputRef}
          className="terminput"
          value={input}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          placeholder="agtail …"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
    </div>
  );
}
