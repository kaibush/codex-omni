import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCollabRolloutTailer,
  findRolloutFile,
  parseCollabRolloutLine
} from "./collab-rollout.js";

describe("parseCollabRolloutLine", () => {
  it("maps spawn_agent function calls", () => {
    const pending = new Map<string, string>();
    const started = parseCollabRolloutLine(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          name: "spawn_agent",
          call_id: "call-spawn-1",
          arguments: JSON.stringify({
            message: "Query the current date",
            fork_context: false
          })
        }
      }),
      pending
    );
    expect(started).toMatchObject({
      itemId: "call-spawn-1",
      tool: "spawn_agent",
      phase: "started",
      prompt: "Query the current date",
      status: "in_progress"
    });
    const completed = parseCollabRolloutLine(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-1",
          output: JSON.stringify({ agent_id: "agent-1", nickname: "Ramanujan" })
        }
      }),
      pending
    );
    expect(completed).toMatchObject({
      itemId: "call-spawn-1",
      tool: "spawn_agent",
      phase: "completed",
      nickname: "Ramanujan",
      receiverThreadIds: ["agent-1"]
    });
  });

  it("ignores update_plan and other non-collab tools", () => {
    const pending = new Map<string, string>();
    expect(
      parseCollabRolloutLine(
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call", name: "update_plan", call_id: "call-plan" }
        }),
        pending
      )
    ).toBeNull();
    expect(
      parseCollabRolloutLine(
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call_output", call_id: "call-plan", output: "Plan updated" }
        }),
        pending
      )
    ).toBeNull();
  });
});

describe("createCollabRolloutTailer", () => {
  it("reads only new collab lines from the rollout file", () => {
    const home = path.join(os.tmpdir(), `codex-omni-rollout-${Date.now()}`);
    const dir = path.join(home, "sessions", "2026", "08", "30");
    mkdirSync(dir, { recursive: true });
    const threadId = "01a0511e-520f-7ab2-b4c3-d00831a8d045";
    const file = path.join(dir, `rollout-2026-08-30T05-22-16-${threadId}.jsonl`);
    writeFileSync(
      file,
      `${JSON.stringify({
        type: "response_item",
        payload: { type: "function_call", name: "update_plan", call_id: "old" }
      })}\n`
    );
    expect(findRolloutFile(home, threadId)).toBe(file);
    const tailer = createCollabRolloutTailer(home);
    tailer.setThreadId(threadId);
    expect(tailer.flush()).toEqual([]);
    writeFileSync(
      file,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          name: "wait_agent",
          call_id: "call-wait-1",
          arguments: JSON.stringify({ targets: [threadId] })
        }
      })}\n`,
      { flag: "a" }
    );
    expect(tailer.flush()).toMatchObject([
      {
        itemId: "call-wait-1",
        tool: "wait_agent",
        phase: "started",
        receiverThreadIds: [threadId]
      }
    ]);
  });
});
