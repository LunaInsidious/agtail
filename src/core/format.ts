// Presentation helpers shared by the CLI, search, and server. Operate on the
// normalized model, so they work the same for every agent.

import type { Event, EventKind } from "./types.js";
import { obj } from "./utils.js";

const CONTENT_KINDS = new Set<EventKind>(["text", "tool_use", "thinking"]);

/**
 * True if a session has any actual conversation (not just metadata/summary/
 * system records). Empty stub sessions — e.g. a lone `bridge-session` line —
 * have nothing to show and are excluded from listings.
 */
export function hasContent(events: Event[]): boolean {
  return events.some((e) => CONTENT_KINDS.has(e.kind));
}

/**
 * Display label for a message's author. Inside a sidechain (subagent) thread the
 * "user" role is actually the parent agent giving instructions, not the human —
 * relabel it so it doesn't masquerade as the user.
 */
export function displayRole(e: Pick<Event, "role" | "sidechain">): string {
  if (e.sidechain && e.role === "user") return "agent";
  return e.role ?? "?";
}

/** True only for a genuine human-typed message (not a subagent instruction). */
export function isHumanMessage(e: Pick<Event, "role" | "sidechain">): boolean {
  return e.role === "user" && !e.sidechain;
}

/** One-line summary of a tool_use input, keyed by common tool names. */
export function summarizeInput(tool: string | undefined, input: unknown): string {
  if (input == null || typeof input !== "object") return String(input ?? "");
  const i = obj(input);
  const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  switch (tool) {
    case "Bash": {
      const cmd = s(i.command).replace(/\n/g, " ");
      const desc = s(i.description);
      return desc ? `${cmd}   « ${desc}` : cmd;
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
    case "exec": // Codex shell call
      return s(i.command) || s(i.cmd);
    case "Task":
      return `${s(i.subagent_type) || "?"}: ${s(i.description)}`;
    default:
      try {
        return JSON.stringify(i);
      } catch {
        return String(i);
      }
  }
}

/** Text that should be searched for a tool_use event (input + summary). */
export function toolSearchText(tool: string | undefined, input: unknown): string {
  const parts = [tool ?? "", summarizeInput(tool, input)];
  try {
    parts.push(JSON.stringify(input ?? ""));
  } catch {
    /* ignore */
  }
  return parts.join(" ");
}
