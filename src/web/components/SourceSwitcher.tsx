import { useEffect, useRef, useState } from "react";

// A header dropdown to scope the whole view to one imported source (a synced
// person/machine) or "All sources". Orthogonal to the content filters — it just
// narrows which sessions are in scope, so an auditor can switch between people.

// Mirror of core's LOCAL_SOURCE sentinel (selects this machine's own sessions).
const LOCAL = "@local";

interface Source {
  name: string;
  count: number;
}
interface Props {
  sources: Source[];
  value: string; // "" = all sources, LOCAL = this machine only, else a collection
  onChange: (source: string) => void;
}

const labelFor = (value: string) => (value === "" ? "All sources" : value === LOCAL ? "Local" : value);

export function SourceSwitcher({ sources, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target instanceof Node ? e.target : null;
      if (ref.current && !ref.current.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (s: string) => {
    onChange(s);
    setOpen(false);
  };

  return (
    <div className="srcmenu" ref={ref}>
      <button
        type="button"
        className={"addfilter" + (value ? " has" : "")}
        onClick={() => setOpen((v) => !v)}
        title="Switch source"
      >
        👤 {labelFor(value)} ▾
      </button>
      {open && (
        <div className="filterpop srcpop">
          <button type="button" className={"savedapply" + (value === "" ? " on" : "")} onClick={() => pick("")}>
            All sources
          </button>
          <button type="button" className={"savedapply" + (value === LOCAL ? " on" : "")} onClick={() => pick(LOCAL)}>
            Local (this machine)
          </button>
          {sources.map((s) => (
            <button
              type="button"
              key={s.name}
              className={"savedapply" + (value === s.name ? " on" : "")}
              onClick={() => pick(s.name)}
            >
              {s.name}
              <em>{s.count}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
