import { useState } from "react";
import { savedChips } from "../lib/filters.js";
import type { SavedSearch } from "../lib/state.js";

// Manage saved searches: a dedicated screen with each search's full conditions
// shown as chips, inline rename, apply, and a two-step (confirmed) delete.
export function ManageSaved({
  saved,
  onApply,
  onRename,
  onDelete,
  onClose,
}: {
  saved: SavedSearch[];
  onApply: (s: SavedSearch) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <div className="screen">
      <div className="screenhead">
        <span className="brand">
          <b>≋</b> agtail · Saved searches
        </span>
        <button type="button" className="addfilter" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="screenbody">
        {saved.length === 0 && (
          <div className="screenempty">
            <p>No saved searches yet.</p>
            <p>
              A saved search is a full filter set (agent, model, project, status, tools, query…) you can recall in one
              click — useful for recurring audits or checks.
            </p>
            <p>
              To create one: on the main screen apply some filters or a search, then open <b>★ Saved</b> →{" "}
              <b>“Save current search”</b>.
            </p>
          </div>
        )}
        {saved.map((s) => {
          const cond = savedChips(s.filters);
          return (
            <div className="mrow" key={s.id}>
              <input
                className="mname"
                value={s.name}
                onChange={(e) => onRename(s.id, e.target.value)}
                aria-label="search name"
              />
              <div className="mchips">
                {cond.length === 0 ? (
                  <span className="mdim">no conditions</span>
                ) : (
                  cond.map((c) => (
                    <span className="fchip nox" key={c.key}>
                      {c.label}
                    </span>
                  ))
                )}
              </div>
              <div className="mactions">
                <button type="button" className="mapply" onClick={() => onApply(s)}>
                  Apply
                </button>
                {confirming === s.id ? (
                  <>
                    <button
                      type="button"
                      className="mdel"
                      onClick={() => {
                        onDelete(s.id);
                        setConfirming(null);
                      }}
                    >
                      Delete
                    </button>
                    <button type="button" className="mcancel" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" className="mtrash" onClick={() => setConfirming(s.id)} title="delete">
                    🗑
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
