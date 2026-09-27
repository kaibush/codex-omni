import { describe, expect, it } from "vitest";
import { bridgeRequestSchema, type BridgeEvent } from "@codex-omni/protocol";
import { createClaudeNormalizer } from "./normalizer.js";

const request = bridgeRequestSchema.parse({
  protocolVersion: 1,
  requestId: "run",
  projectId: "project",
  sessionId: "session",
  clientType: "claude-code",
  cwd: "/tmp",
  runtimeHome: "/tmp/claude",
  runtimeKey: "key",
  message: "hello",
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  networkAccessEnabled: true
});
const message = (value: Record<string, unknown>) => ({
  session_id: "native-session",
  uuid: "uuid",
  ...value
});

describe("Claude SDK event normalization", () => {
  it("keeps block identity when the SDK completes thinking and text in separate snapshots", () => {
    const normalizer = createClaudeNormalizer(request);
    const events: BridgeEvent[] = [];
    const stream = (event: Record<string, unknown>) =>
      events.push(...normalizer.normalize(message({ type: "stream_event", event })));
    const snapshot = (block: Record<string, unknown>) =>
      events.push(
        ...normalizer.normalize(
          message({ type: "assistant", message: { id: "weather", content: [block] } })
        )
      );
    stream({ type: "message_start", message: { id: "weather" } });
    stream({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "" }
    });
    stream({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Check weather" }
    });
    snapshot({ type: "thinking", thinking: "Check weather" });
    stream({ type: "content_block_stop", index: 0 });
    stream({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
    const answer =
      "| City | Weather |\n|---|---|\n| Sydney | Rain |\n\n[Source](https://example.com/weather)";
    stream({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: answer } });
    snapshot({ type: "text", text: answer });
    stream({ type: "content_block_stop", index: 1 });
    stream({ type: "message_stop" });

    const replies = events.filter((event) => event.type.startsWith("assistant."));
    expect(new Set(replies.map((event) => (event.payload as any).itemId))).toEqual(
      new Set(["weather:1"])
    );
    expect(replies.filter((event) => event.type === "assistant.completed")).toHaveLength(1);
    expect(replies.at(-1)).toMatchObject({
      type: "assistant.completed",
      payload: { text: answer }
    });
    expect(events.filter((event) => event.type === "reasoning.delta").at(-1)).toMatchObject({
      payload: { itemId: "weather:0", text: "Check weather", phase: "completed" }
    });
  });

  it.each(["content_block_stop", "message_stop", "result"])(
    "settles text on %s even without an assistant snapshot",
    (ending) => {
      const normalizer = createClaudeNormalizer(request);
      normalizer.normalize(
        message({ type: "stream_event", event: { type: "message_start", message: { id: "m" } } })
      );
      normalizer.normalize(
        message({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 2,
            delta: { type: "text_delta", text: "**Done**" }
          }
        })
      );
      const end =
        ending === "result"
          ? message({ type: "result", subtype: "success", result: "**Done**" })
          : message({ type: "stream_event", event: { type: ending, index: 2 } });
      expect(normalizer.normalize(end)).toContainEqual(
        expect.objectContaining({
          type: "assistant.completed",
          payload: expect.objectContaining({ itemId: "m:2", text: "**Done**" })
        })
      );
      expect(
        normalizer.normalize(end).filter((event) => event.type === "assistant.completed")
      ).toHaveLength(0);
    }
  );

  it("preserves repeated text blocks and full snapshots after individual block snapshots", () => {
    const normalizer = createClaudeNormalizer(request);
    normalizer.normalize(
      message({ type: "stream_event", event: { type: "message_start", message: { id: "m" } } })
    );
    const events: BridgeEvent[] = [];
    const content = [
      { type: "thinking", thinking: "Check" },
      { type: "text", text: "Same" },
      { type: "text", text: "Same" }
    ];
    for (const [index, block] of content.entries()) {
      events.push(
        ...normalizer.normalize(
          message({
            type: "stream_event",
            event: { type: "content_block_start", index, content_block: block }
          })
        )
      );
      events.push(
        ...normalizer.normalize(
          message({ type: "stream_event", event: { type: "content_block_stop", index } })
        )
      );
      events.push(
        ...normalizer.normalize(
          message({ type: "assistant", message: { id: "m", content: [block] } })
        )
      );
    }
    events.push(
      ...normalizer.normalize(message({ type: "assistant", message: { id: "m", content } }))
    );
    expect(
      events
        .filter((event) => event.type === "assistant.completed")
        .map((event) => (event.payload as any).itemId)
    ).toEqual(["m:1", "m:2"]);
  });

  it("keeps interleaved child text separate and does not close it on a main result", () => {
    const normalizer = createClaudeNormalizer(request);
    const stream = (parent: string | null, event: Record<string, unknown>) =>
      normalizer.normalize(message({ type: "stream_event", parent_tool_use_id: parent, event }));
    stream(null, { type: "message_start", message: { id: "main" } });
    stream("agent", { type: "message_start", message: { id: "child" } });
    stream(null, {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "Main" }
    });
    stream("agent", {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "Child" }
    });
    const done = normalizer.normalize(
      message({ type: "result", subtype: "success", result: "Main" })
    );
    expect(done.map((event) => event.type)).toEqual(["assistant.completed", "turn.completed"]);
    expect(done[0]?.payload).toMatchObject({ itemId: "main:1", text: "Main" });
    const child = normalizer.normalize(
      message({
        type: "assistant",
        parent_tool_use_id: "agent",
        message: { id: "child", content: [{ type: "text", text: "Child" }] }
      })
    );
    expect(child).toHaveLength(1);
    expect(child[0]).toMatchObject({
      type: "tool.output",
      payload: { itemId: "child:1", parentToolUseId: "agent", output: "Child", status: "completed" }
    });
  });

  it("joins streaming and final text into the same item without duplicate messages", () => {
    const normalizer = createClaudeNormalizer(request);
    normalizer.normalize(
      message({ type: "stream_event", event: { type: "message_start", message: { id: "msg1" } } })
    );
    const streaming = normalizer.normalize(
      message({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" }
        }
      })
    );
    const final = normalizer.normalize(
      message({
        type: "assistant",
        message: { id: "msg1", content: [{ type: "text", text: "Hello world" }] }
      })
    );
    expect(streaming[0]).toMatchObject({
      type: "assistant.delta",
      payload: { itemId: "msg1:0", delta: "Hello" }
    });
    expect(final[0]).toMatchObject({
      type: "assistant.completed",
      payload: { itemId: "msg1:0", text: "Hello world" }
    });
    const done = normalizer.normalize(
      message({
        type: "result",
        subtype: "success",
        result: "Hello world",
        usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 7 }
      })
    );
    expect(done.map((event) => event.type)).toEqual(["turn.completed"]);
    expect(done[0]?.payload).toMatchObject({
      usage: { input_tokens: 17, output_tokens: 3, cached_input_tokens: 7 }
    });
  });

  it("keeps subagent output out of the main assistant and tracks background tasks", () => {
    const normalizer = createClaudeNormalizer(request);
    normalizer.normalize(
      message({
        type: "assistant",
        message: {
          id: "main",
          content: [
            {
              type: "tool_use",
              id: "agent-tool",
              name: "Agent",
              input: { description: "Review", subagent_type: "Explore", prompt: "inspect" }
            }
          ]
        }
      })
    );
    normalizer.normalize(
      message({
        type: "system",
        subtype: "task_started",
        task_id: "task1",
        tool_use_id: "agent-tool",
        is_backgrounded: true
      })
    );
    expect(normalizer.activeTasks.has("task1")).toBe(true);
    const child = normalizer.normalize(
      message({
        type: "assistant",
        parent_tool_use_id: "agent-tool",
        message: { id: "child", content: [{ type: "text", text: "found issue" }] }
      })
    );
    expect(child[0]).toMatchObject({
      type: "tool.output",
      payload: { tool: "subagent_message", parentToolUseId: "agent-tool", output: "found issue" }
    });
    const finished = normalizer.normalize(
      message({
        type: "system",
        subtype: "task_notification",
        task_id: "task1",
        status: "completed",
        summary: "review done"
      })
    );
    expect(normalizer.activeTasks.size).toBe(0);
    expect(finished[0]?.payload).toMatchObject({
      itemId: "agent-tool",
      taskId: "task1",
      status: "completed",
      output: "review done"
    });
  });

  it("maps plans, tool errors, file changes, and budget failures", () => {
    const normalizer = createClaudeNormalizer(request);
    const plan = normalizer.normalize(
      message({
        type: "assistant",
        message: {
          id: "m",
          content: [
            {
              type: "tool_use",
              id: "todo",
              name: "TodoWrite",
              input: { todos: [{ content: "Test", status: "in_progress" }] }
            },
            { type: "tool_use", id: "edit", name: "Edit", input: { file_path: "/tmp/a.ts" } }
          ]
        }
      })
    );
    expect(plan.some((event) => (event.payload as any).tool === "update_plan")).toBe(true);
    const output = normalizer.normalize(
      message({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "edit", content: "saved" }] }
      })
    );
    expect(output.some((event) => event.type === "file.change")).toBe(true);
    const failed = normalizer.normalize(
      message({
        type: "result",
        subtype: "error_max_budget_usd",
        is_error: true,
        errors: ["Budget exhausted"]
      })
    );
    expect(failed.at(-1)).toMatchObject({
      type: "run.failed",
      payload: { message: "Budget exhausted" }
    });
  });

  it("renders SDK structured patches as valid unified diffs and ignores staged edits", () => {
    const normalizer = createClaudeNormalizer(request);
    normalizer.normalize(
      message({
        type: "assistant",
        message: {
          id: "m",
          content: [{ type: "tool_use", id: "edit", name: "Edit", input: { file_path: "a.ts" } }]
        }
      })
    );
    const result = {
      structuredPatch: [
        { oldStart: 2, oldLines: 1, newStart: 2, newLines: 2, lines: ["-old", "+new", "+added"] }
      ]
    };
    const output = {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "edit", content: "saved" }] },
      tool_use_result: result
    };
    const events = normalizer.normalize(message(output));
    expect(
      (events.find((event) => event.type === "file.change")?.payload as any).changes[0].diff
    ).toBe("--- a/a.ts\n+++ b/a.ts\n@@ -2,1 +2,2 @@\n-old\n+new\n+added\n");
    expect(
      normalizer
        .normalize(message({ ...output, tool_use_result: { ...result, staged: true } }))
        .some((event) => event.type === "file.change")
    ).toBe(false);
    const invalid = normalizer.normalize(
      message({
        ...output,
        tool_use_result: { structuredPatch: [{ ...result.structuredPatch[0], oldLines: 9 }] }
      })
    );
    expect(
      (invalid.find((event) => event.type === "file.change")?.payload as any).changes[0].diff
    ).toBe("");
  });

  it("does not complete background tasks on their launch result or revive completed tasks on metadata updates", () => {
    const normalizer = createClaudeNormalizer(request);
    normalizer.normalize(
      message({
        type: "assistant",
        message: { id: "m", content: [{ type: "tool_use", id: "agent", name: "Agent", input: {} }] }
      })
    );
    normalizer.normalize(
      message({ type: "system", subtype: "task_started", task_id: "task", tool_use_id: "agent" })
    );
    const launch = normalizer.normalize(
      message({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "agent", content: "launched" }] },
        tool_use_result: { status: "async_launched" }
      })
    );
    expect(launch.at(-1)?.payload).toMatchObject({ status: "in_progress" });
    expect(normalizer.activeTasks.has("task")).toBe(true);
    normalizer.normalize(
      message({
        type: "system",
        subtype: "task_notification",
        task_id: "task",
        status: "completed"
      })
    );
    normalizer.normalize(
      message({
        type: "system",
        subtype: "task_updated",
        task_id: "task",
        patch: { description: "Final summary" }
      })
    );
    expect(normalizer.activeTasks.size).toBe(0);
  });
});
