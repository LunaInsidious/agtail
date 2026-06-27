import type { SavedSearch } from "../lib/state.js";

// The saved-search dropdown: the list of saved searches, the inline "Save
// current search" naming flow, and the link to the manage screen.
// Presentational — all state and handlers live in the App container.
export function SavedMenu({
  saved,
  activeSaved,
  anyFilter,
  namingDraft,
  setNamingDraft,
  applySaved,
  startNaming,
  commitSave,
  openManage,
}: {
  saved: SavedSearch[];
  activeSaved: SavedSearch | undefined;
  anyFilter: boolean;
  namingDraft: string | null;
  setNamingDraft: (v: string | null) => void;
  applySaved: (s: SavedSearch) => void;
  startNaming: () => void;
  commitSave: () => void;
  openManage: () => void;
}) {
  return (
    <div className="filterpop savedpop">
      {saved.length === 0 && (
        <div className="savedempty">
          No saved searches yet. Save a set of filters/search to recall it in one click — handy for recurring checks
          &amp; audits.
        </div>
      )}
      {saved.map((s) => (
        <button
          type="button"
          className={"savedapply" + (s.id === activeSaved?.id ? " on" : "")}
          key={s.id}
          onClick={() => applySaved(s)}
          title="apply this search"
        >
          ★ {s.name}
        </button>
      ))}
      {namingDraft === null ? (
        // Custom tooltip on the wrapper (the disabled button can't hover);
        // instant, unlike the native `title` which has a fixed ~1-2s delay.
        <span className="savecurwrap">
          <button type="button" className="savecur" disabled={!anyFilter || !!activeSaved} onClick={startNaming}>
            ＋ Save current search
          </button>
          {(!anyFilter || activeSaved) && (
            <span className="tip">
              {activeSaved
                ? `✓ These conditions are already saved as “${activeSaved.name}”.`
                : "💡 Apply a filter or search first — then you can save it here."}
            </span>
          )}
        </span>
      ) : (
        <div className="naming">
          <input
            className="nameinput"
            autoFocus
            value={namingDraft}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setNamingDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSave();
              else if (e.key === "Escape") setNamingDraft(null);
            }}
            aria-label="save search as"
          />
          <button type="button" className="namesave" onClick={commitSave}>
            Save
          </button>
        </div>
      )}
      <button type="button" className="savemanage" onClick={openManage}>
        Manage saved searches →
      </button>
    </div>
  );
}
