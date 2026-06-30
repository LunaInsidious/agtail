import type { Filters } from "../lib/api.js";
import { homeShort, tag } from "../lib/filters.js";
import { AGENTS, LIMIT_OPTIONS } from "../lib/state.js";
import { CheckList } from "./CheckList.js";

// The filters popover: tool/model/project checklists, date range, agent /
// status / origin toggles, mask toggle, max-results select, and Clear-all.
// Presentational — all state and handlers live in the App container.
// The facet-driven checklists' labels are known ahead of their options, so the
// skeleton shows them in place — only the option rows fill in on load, no shift.
const FACET_LABELS = ["tool", "model", "project (cwd)"];

function FacetSkeleton() {
  return (
    <>
      {FACET_LABELS.map((label) => (
        <div className="frow" key={label} aria-busy="true">
          <span className="lbl">{label}</span>
          <div className="checklist skeleton">
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel-line" />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export function FilterPanel({
  filters,
  facets,
  facetsLoading,
  limit,
  setLimit,
  set,
  toggleStatus,
  toggleOrigin,
  clearAll,
  chipCount,
}: {
  filters: Filters;
  facets: { tools: string[]; cwds: string[]; models: string[] };
  facetsLoading: boolean;
  limit: number;
  setLimit: (n: number) => void;
  set: (p: Partial<Filters>) => void;
  toggleStatus: (k: "active" | "archived") => void;
  toggleOrigin: (k: "interactive" | "programmatic") => void;
  clearAll: () => void;
  chipCount: number;
}) {
  // Skeleton only on the first load (facets still empty); a post-import refresh
  // keeps the populated lists rather than flashing placeholders over them.
  const facetsEmpty = !facets.tools.length && !facets.models.length && !facets.cwds.length;
  return (
    <div className="filterpop">
      {facetsLoading && facetsEmpty && <FacetSkeleton />}
      <CheckList
        label="tool"
        options={[
          ...(facets.tools.some((t) => t.startsWith("mcp__")) ? [{ value: "mcp__*", label: "mcp__* (all MCP)" }] : []),
          ...facets.tools.map((t) => ({ value: t, label: t })),
        ]}
        selected={filters.tools}
        onChange={(tools) => set({ tools })}
      />
      <CheckList
        label="model"
        options={facets.models.map((m) => ({ value: m, label: m }))}
        selected={filters.models}
        onChange={(models) => set({ models })}
      />
      <CheckList
        label="project (cwd)"
        options={facets.cwds.map((c) => ({ value: c, label: homeShort(c) }))}
        selected={filters.cwds}
        onChange={(cwds) => set({ cwds })}
      />
      <div className="frow">
        <span className="lbl">date range</span>
        <div className="dates">
          <input type="date" value={filters.since} onChange={(e) => set({ since: e.target.value })} title="since" />
          <input type="date" value={filters.until} onChange={(e) => set({ until: e.target.value })} title="until" />
        </div>
      </div>
      <div className="frow">
        <span className="lbl">agent</span>
        <span className="agents">
          {AGENTS.map((a) => (
            <label key={a} className={filters.agents.includes(a) ? "on" : ""}>
              <input
                type="checkbox"
                checked={filters.agents.includes(a)}
                onChange={(e) =>
                  set({
                    agents: e.target.checked ? [...filters.agents, a] : filters.agents.filter((x) => x !== a),
                  })
                }
              />
              {tag(a)}
            </label>
          ))}
        </span>
      </div>
      <div className="frow">
        <span className="lbl">status</span>
        <span className="agents">
          <label className={filters.archived === "none" ? "on" : ""}>
            <input type="checkbox" checked={filters.archived === "none"} onChange={() => toggleStatus("active")} />
            active
          </label>
          <label className={filters.archived === "only" ? "on" : ""}>
            <input type="checkbox" checked={filters.archived === "only"} onChange={() => toggleStatus("archived")} />🗄
            archived
          </label>
        </span>
      </div>
      <div className="frow">
        <span className="lbl">origin</span>
        <span className="agents">
          <label className={filters.programmatic === "none" ? "on" : ""}>
            <input
              type="checkbox"
              checked={filters.programmatic === "none"}
              onChange={() => toggleOrigin("interactive")}
            />
            interactive
          </label>
          <label className={filters.programmatic === "only" ? "on" : ""}>
            <input
              type="checkbox"
              checked={filters.programmatic === "only"}
              onChange={() => toggleOrigin("programmatic")}
            />
            🤖 programmatic
          </label>
        </span>
      </div>
      <div className="frow">
        <span className="lbl">output</span>
        <label className="mask">
          <input type="checkbox" checked={filters.mask} onChange={(e) => set({ mask: e.target.checked })} />
          Mask secrets
        </label>
      </div>
      <div className="frow">
        <span className="lbl">max results</span>
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {LIMIT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {chipCount > 0 && (
        <button type="button" className="clear" onClick={clearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
