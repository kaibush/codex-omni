import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "@codex-omni/db";
import { backfillSessionRolloutTools } from "./session-rollout.js";

let store: Store | undefined;
afterEach(() => store?.db.close());

describe("backfillSessionRolloutTools", () => {
  it("overlays empty runtime_error placeholders with spawn_agent cards", () => {
    store = new Store(":memory:");
    const provider = store.upsertProvider({ name: "Provider" });
    const project = store.createProject({
      name: "Project",
      displayPath: "/tmp",
      realPath: "/tmp",
      providerId: provider.id
    });
    const session = store.createSession({ projectId: project.id, providerId: provider.id });
    const threadId = "01a05155-b1b8-7d10-ad12-a238b00d7095";
    store.updateSession(session.id, { threadId });
    const startedAt = Date.parse("2026-08-30T06:22:45.694Z");
    store.upsertEventMessage({
      sessionId: session.id,
      role: "tool",
      content: "",
      providerId: provider.id,
      eventType: "tool.output",
      itemId: "turn-1:item_6",
      dataJson: JSON.stringify({ itemId: "item_6", tool: "runtime_error", output: "" }),
      createdAt: startedAt
    });
    const home = path.join(os.tmpdir(), `codex-omni-session-rollout-${Date.now()}`);
    const dir = path.join(home, "sessions", "2026", "08", "30");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `rollout-2026-08-30T06-22-45-${threadId}.jsonl`),
      `${JSON.stringify({
        timestamp: "2026-08-30T06:22:45.680Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "spawn_agent",
          call_id: "call-spawn-live",
          arguments: JSON.stringify({ message: "Query the current date", fork_context: false })
        }
      })}\n${JSON.stringify({
        timestamp: "2026-08-30T06:22:45.787Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-live",
          output: JSON.stringify({ agent_id: "agent-pascal", nickname: "Pascal" })
        }
      })}\n`
    );
    const changes = backfillSessionRolloutTools({
      store,
      sessionId: session.id,
      threadId,
      providerId: provider.id,
      codexHome: home
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.itemId).toBe("turn-1:item_6");
    const message = store.getMessageByItemId(session.id, "turn-1:item_6");
    expect(message?.createdAt).toBe(startedAt);
    expect(JSON.parse(message?.dataJson ?? "{}")).toMatchObject({
      tool: "spawn_agent",
      nickname: "Pascal",
      prompt: "Query the current date",
      receiverThreadIds: ["agent-pascal"]
    });
    expect(
      backfillSessionRolloutTools({
        store,
        sessionId: session.id,
        threadId,
        providerId: provider.id,
        codexHome: home
      })
    ).toEqual([]);
    expect(store.listMessages(session.id)).toHaveLength(1);
  });
});
