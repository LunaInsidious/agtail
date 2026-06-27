import { useState } from "react";

// Collapsible checkbox list for an array filter (tools / models / projects):
// click to toggle; selections also show as removable chips in the bar. The
// header shows the selected count and long lists (>8) start collapsed to keep
// the popover compact. Mounts with the popover, so options are already loaded.
export function CheckList({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(() => options.length <= 8);
  if (!options.length) return null;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="frow">
      <button type="button" className="disc" onClick={() => setOpen((o) => !o)}>
        <span className="lbl">
          {label}
          {selected.length ? ` (${selected.length})` : ""}
        </span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="checklist">
          {options.map((o) => (
            <label key={o.value} className={selected.includes(o.value) ? "on" : ""}>
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
