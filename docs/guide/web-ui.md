# Web UI

`agtail serve` opens a search-first, two-pane viewer on `http://127.0.0.1:8765`. It binds to loopback only and makes no external calls — the local process exists because a browser can't read your filesystem directly; it reads the transcripts and hands them to the page.

```sh
agtail serve            # then open http://127.0.0.1:8765
```

For live UI development (hot reload), `pnpm dev:web` runs a self-contained dev server with the same API built in — no separate backend needed.

## Header — global search

A search box for cross-agent grep, plus filters:

- **agent** checkboxes (claude / codex)
- **tool** dropdown — populated from the tools that actually appear in your history (with an `mcp__*` convenience entry)
- **cwd** dropdown — the distinct working directories found across sessions
- **since / until** date range
- **mask** toggle — redact secrets

The tool and cwd options come from a cached `/api/facets` scan, so they're finite, selectable lists rather than free text.

## Left pane — sessions & hits

Two tabs:

- **Sessions** — the cross-agent list, newest first, with a source tag per row. Subagent sessions are **nested under their parent** with the agent type as a badge.
- **Hits** — results of the last search, each row jumping to its session.

The divider between the panes is **draggable** to resize the sidebar; the width is remembered across reloads.

## Right pane — timeline

The selected session, rendered as a timeline:

- Assistant / user **text** is rendered as Markdown.
- A **sidechain "user" message is labeled `agent`** — inside a subagent thread that text is the parent agent's instruction, not the human.
- **Tool calls** show a header you can expand (`▸/▾`) to reveal input and result.
- Heavy blocks (long text, thinking, raw `unknown` records) are **collapsed by default** and expandable.
- Each turn shows a **token / cost badge** pinned to the top-right (see [Tokens & cost](./cost)).

### In-session search

A search box in the timeline header filters the current session to matching events, highlights the term, shows a match count, and auto-expands matching tool details. It follows the page as you scroll. This is separate from the global (cross-session) search.
