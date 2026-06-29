import { type RefObject, useEffect, useRef, useState } from "react";
import { apiExport, apiImport, type Filters, type ImportMode } from "../lib/api.js";
import { isRecord } from "../lib/util.js";

// Two separate, purpose-fit controls:
//  • ExportButton lives on the session-list header, beside the "Results (12) /
//    Sessions (488)" count — because export means "give me what I'm looking at".
//    The label tracks the filter (Export all / Export results); with a filter it
//    exports the matches (server re-runs them unbounded), else the whole machine.
//  • ImportButton lives in the app header — import brings in a cross-machine
//    bundle, unrelated to the current view, landing in the view-only store (📥).
// Both CONFIRM before doing anything: export never downloads, and import never
// writes, on a single stray click.

/** Close `open` when a mousedown lands outside `ref`. */
function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target instanceof Node ? e.target : null;
      if (ref.current && !ref.current.contains(t)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref/onClose are stable; only re-bind when the popover toggles.
  }, [open]);
}

function download(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `agtail-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

interface ExportProps {
  /** Whether any filter is narrowing the list (→ export the matches, not all). */
  activeFilter: boolean;
  /** Sessions currently listed, or null if unknown. */
  count: number | null;
  /** Whether `count` is a display-capped lower bound (shown as "N+"). The export
   *  itself is never capped. */
  truncated: boolean;
  /** Active filters, sent to the server for a filtered export. */
  filters: Filters;
}

export function ExportButton({ activeFilter, count, truncated, filters }: ExportProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(wrapRef, open, () => setOpen(false));

  const doExport = async () => {
    download(await apiExport(activeFilter ? filters : undefined));
    setOpen(false);
  };
  const n = count ?? "…";
  const label = activeFilter ? "Export results" : "Export all";
  const scope = activeFilter
    ? `the ${n}${truncated ? "+" : ""} session${count === 1 ? "" : "s"} matching the current filter`
    : `all ${n} sessions`;
  return (
    <div className="exp" ref={wrapRef}>
      <button type="button" className="lhbtn" title="Export sessions to a file" onClick={() => setOpen((v) => !v)}>
        ⬇ {label}
      </button>
      {open && (
        <div className="filterpop syncpop exppop">
          <div className="syncmsg">
            <div>Export {scope} to a file?</div>
            <div className="row">
              <button type="button" className="mcancel" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="namesave" onClick={() => void doExport()}>
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface Pending {
  name: string;
  count: number;
  text: string;
}
interface ImportResult {
  written: number;
  skipped: number;
}

/** File count of a parsed bundle, or null if it isn't an agtail export. */
function bundleFileCount(parsed: unknown): number | null {
  if (!isRecord(parsed) || parsed.agtailExport !== 1 || !Array.isArray(parsed.files)) return null;
  return parsed.files.length;
}

/** Validate a picked file's text as a bundle, returning its file count. Bad JSON
 *  and wrong shape both yield null so the popover can show one clear error. */
function safeCount(text: string): number | null {
  try {
    return bundleFileCount(JSON.parse(text));
  } catch {
    return null;
  }
}

/** A safe collection name must match the server's allowed segment charset. */
const validCollection = (s: string) => /^[A-Za-z0-9._-]+$/.test(s);

/** A default collection name from the bundle's filename (sans extension). */
function deriveCollection(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "imported";
}

interface ImportPopProps {
  pending: Pending | null;
  result: ImportResult | null;
  error: string | null;
  mode: ImportMode;
  overwrite: boolean;
  ack: boolean;
  collection: string;
  /** Existing collections to optionally import into (overwrite/append). */
  existingSources: string[];
  /** A chosen existing collection, or "" to create a new named one. */
  existing: string;
  setMode: (m: ImportMode) => void;
  setOverwrite: (b: boolean) => void;
  setCollection: (s: string) => void;
  setExisting: (s: string) => void;
  toggleAck: () => void;
  pickFile: () => void;
  clearFile: () => void;
  confirm: () => void;
  close: () => void;
  back: () => void;
}

interface RadioProps {
  name: string;
  on: boolean;
  onPick: () => void;
  label: string;
  hint?: string;
}
function Radio({ name, on, onPick, label, hint }: RadioProps) {
  return (
    <label className={on ? "on" : ""}>
      <input type="radio" name={name} checked={on} onChange={onPick} />
      {label}
      {hint ? <em>{hint}</em> : null}
    </label>
  );
}

/** The import form: choose a destination + conflict policy FIRST, then pick the
 *  bundle file, then Import. Defaults are the safe ones (view-only store, skip
 *  existing). The one irreversible combo — native + overwrite, which replaces
 *  real history — is gated behind a red warning + acknowledgement, and Import is
 *  disabled until a file is chosen (and, when dangerous, acknowledged). */
function ImportForm(p: ImportPopProps) {
  const danger = p.mode === "native" && p.overwrite;
  // Targeting an existing collection is always valid; a new one must be a safe name.
  const nameOk = p.mode !== "agtail" || p.existing !== "" || validCollection(p.collection);
  const ready = p.pending !== null && nameOk && (!danger || p.ack);
  return (
    <div className="syncmsg">
      <div className="syncopt">
        <span className="lbl">Destination</span>
        <Radio
          name="agtail-dest"
          on={p.mode === "agtail"}
          onPick={() => p.setMode("agtail")}
          label="View only in agtail 📥"
          hint="audit"
        />
        <Radio
          name="agtail-dest"
          on={p.mode === "native"}
          onPick={() => p.setMode("native")}
          label="Add to Claude Code / Codex"
          hint="migrate"
        />
      </div>
      <div className="syncopt">
        <span className="lbl">If a file already exists</span>
        <Radio name="agtail-conf" on={!p.overwrite} onPick={() => p.setOverwrite(false)} label="Skip it (append)" />
        <Radio name="agtail-conf" on={p.overwrite} onPick={() => p.setOverwrite(true)} label="Overwrite it" />
      </div>
      {danger ? (
        <div className="dangerbox">
          <span>
            ⚠ This <b>overwrites</b> matching files in your real ~/.claude / ~/.codex history. It cannot be undone.
          </span>
          <label className="ack">
            <input type="checkbox" checked={p.ack} onChange={p.toggleAck} />I understand — overwrite my real history
          </label>
        </div>
      ) : (
        <div className={p.mode === "native" ? "note warn" : "note"}>
          {p.mode === "native"
            ? "Writes into your real ~/.claude / ~/.codex directories (new files only)."
            : "View-only; your real history stays untouched."}
        </div>
      )}
      <div className="filepick">
        {p.pending ? (
          <span className="picked">
            <span className="pname">
              📄 {p.pending.name} ({p.pending.count} files)
            </span>
            <button type="button" className="changefile" onClick={p.pickFile}>
              Change
            </button>
            <button type="button" className="xfile" onClick={p.clearFile} aria-label="Remove file" title="Remove file">
              ✕
            </button>
          </span>
        ) : (
          <button type="button" className="choosefile" onClick={p.pickFile}>
            Choose a bundle file…
          </button>
        )}
      </div>
      {p.mode === "agtail" && p.pending && (
        <div className="syncopt">
          <span className="lbl">
            Source {p.existing ? "(import into an existing one)" : "(keeps this import separate)"}
          </span>
          {p.existingSources.length > 0 && (
            <select value={p.existing} onChange={(e) => p.setExisting(e.target.value)}>
              <option value="">➕ New source…</option>
              {p.existingSources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          {p.existing === "" && (
            <input
              className={"nameinput" + (nameOk ? "" : " bad")}
              value={p.collection}
              onChange={(e) => p.setCollection(e.target.value)}
              placeholder="e.g. alice-macbook"
              spellCheck={false}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </div>
      )}
      <div className="row">
        <button type="button" className="mcancel" onClick={p.close}>
          Cancel
        </button>
        <button type="button" className={danger ? "namesave danger" : "namesave"} disabled={!ready} onClick={p.confirm}>
          {danger ? "Overwrite" : "Import"}
        </button>
      </div>
    </div>
  );
}

/** The import popover: a small state machine over result → error → the form. */
function ImportPop(p: ImportPopProps) {
  if (p.result) {
    return (
      <div className="syncmsg">
        <div>
          Imported {p.result.written}, skipped {p.result.skipped}.
        </div>
        <div className="row">
          <button type="button" className="namesave" onClick={p.close}>
            Done
          </button>
        </div>
      </div>
    );
  }
  if (p.error) {
    return (
      <div className="syncmsg">
        <div className="err">{p.error}</div>
        <div className="row">
          <button type="button" className="mcancel" onClick={p.back}>
            Back
          </button>
        </div>
      </div>
    );
  }
  return <ImportForm {...p} />;
}

interface ImportProps {
  /** Existing collections, so an import can target one (overwrite/append). */
  existingSources: string[];
  /** Called after a successful import so the parent can refresh its lists. */
  onImported: () => void;
}

export function ImportButton({ existingSources, onImported }: ImportProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Safe defaults: view-only store, append (skip existing).
  const [mode, setMode] = useState<ImportMode>("agtail");
  const [overwrite, setOverwrite] = useState(false);
  // Acknowledgement of the irreversible native+overwrite combo; any change to the
  // destination/conflict choice clears it so it must be re-confirmed.
  const [ack, setAck] = useState(false);
  // New-collection name (from the filename), or `existing` to target an existing
  // one. The effective target is `existing || collection`.
  const [collection, setCollection] = useState("");
  const [existing, setExisting] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const pickMode = (m: ImportMode) => {
    setMode(m);
    setAck(false);
  };
  const pickOverwrite = (b: boolean) => {
    setOverwrite(b);
    setAck(false);
  };
  // Close + clear everything (so the next open starts at the safe defaults).
  const close = () => {
    setOpen(false);
    setPending(null);
    setResult(null);
    setError(null);
    setMode("agtail");
    setOverwrite(false);
    setAck(false);
    setCollection("");
    setExisting("");
  };
  useDismiss(wrapRef, open, close);

  // Picking a file only stages it (keeping the destination/conflict choices made
  // first); the actual write waits for the Import button.
  const onPick = async (file: File) => {
    setResult(null);
    setError(null);
    const text = await file.text();
    const count = safeCount(text);
    if (count === null) {
      setError("Not an agtail export bundle.");
      return;
    }
    setPending({ name: file.name, count, text });
    // Seed a default collection name from the filename (editable before import).
    if (!collection) setCollection(deriveCollection(file.name));
  };
  const confirmImport = async () => {
    if (!pending) return;
    try {
      const res = await apiImport(pending.text, { mode, overwrite, collection: existing || collection });
      setResult(res);
      if (res.written > 0) onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "import failed");
    }
  };

  return (
    <div className="imp" ref={wrapRef}>
      <button
        type="button"
        className="addfilter"
        title="Import sessions from a file"
        onClick={() => (open ? close() : setOpen(true))}
      >
        ⬆ Import
      </button>
      {open && (
        <div className="filterpop syncpop imppop">
          <ImportPop
            pending={pending}
            result={result}
            error={error}
            mode={mode}
            overwrite={overwrite}
            ack={ack}
            collection={collection}
            existingSources={existingSources}
            existing={existing}
            setMode={pickMode}
            setOverwrite={pickOverwrite}
            setCollection={setCollection}
            setExisting={setExisting}
            toggleAck={() => setAck((v) => !v)}
            pickFile={() => fileRef.current?.click()}
            clearFile={() => setPending(null)}
            confirm={() => void confirmImport()}
            close={close}
            back={() => setError(null)}
          />
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPick(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
