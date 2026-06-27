import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { claudeCodeAdapter } from "../src/core/adapters/claude-code.js";
import { displayRole, isHumanMessage } from "../src/core/format.js";

const root = fileURLToPath(new URL("./fixtures-sub", import.meta.url));

describe("subagent (sidechain) linkage", () => {
  it("tags subagent transcripts with parent + agent type from meta.json", async () => {
    const metas = await claudeCodeAdapter(root).findSessions();
    const sub = metas.find((m) => m.agentName === "Explore");
    expect(sub).toBeDefined();
    expect(sub?.parentId).toBe("parent-1");
    expect(sub?.agentName).toBe("Explore");
    expect(sub?.spawnedByToolUseId).toBe("toolu_x");
    expect(sub?.title).toBe("map the repo");

    const parent = metas.find((m) => !m.isSubagent);
    expect(parent?.id).toBe("parent-1");
  });

  it("detects Workflow subagents nested under subagents/workflows/wf_*/", async () => {
    const metas = await claudeCodeAdapter(root).findSessions();
    const wf = metas.find((m) => m.agentName === "workflow-subagent");
    expect(wf).toBeDefined();
    expect(wf?.isSubagent).toBe(true);
    expect(wf?.parentId).toBe("parent-1"); // dir above subagents/, not "workflows"
  });

  it("relabels a sidechain 'user' message as the parent agent, not the human", async () => {
    const metas = await claudeCodeAdapter(root).findSessions();
    const sub = metas.find((m) => m.isSubagent);
    expect(sub).toBeDefined();
    if (!sub) return;
    const sess = await claudeCodeAdapter(root).readSession(sub.path);
    const firstText = sess.events.find((e) => e.kind === "text" && e.role === "user");
    expect(firstText).toBeDefined();
    if (!firstText) return;
    expect(firstText.sidechain).toBe(true);
    expect(isHumanMessage(firstText)).toBe(false);
    expect(displayRole(firstText)).toBe("agent");
  });
});
