import { describe, expect, it } from "vitest";
import { createNormalizer } from "./normalizer.js";
const req = {
  protocolVersion: 1 as const,
  requestId: "r",
  projectId: "p",
  sessionId: "s",
  cwd: "/tmp",
  runtimeKey: "k",
  codexHome: "/tmp/home",
  message: "hi",
  sandbox: "workspace-write" as const,
  approvalPolicy: "never" as const,
  networkAccessEnabled: true
};
describe("normalizer", () => {
  it("maps command items", () => {
    const n = createNormalizer(req);
    const [event] = n.map({
      type: "item.completed",
      item: {
        id: "x",
        type: "command_execution",
        command: "pwd",
        aggregated_output: "/tmp",
        exit_code: 0,
        status: "completed"
      }
    });
    expect(event?.type).toBe("tool.output");
  });

  it("maps todo_list items to update_plan", () => {
    const n = createNormalizer(req);
    const [started] = n.map({
      type: "item.started",
      item: {
        id: "plan-1",
        type: "todo_list",
        items: [
          { text: "检查仓库", completed: false },
          { text: "补齐测试", completed: true }
        ]
      }
    });
    expect(started).toMatchObject({
      type: "tool.started",
      payload: {
        itemId: "plan-1",
        tool: "update_plan",
        status: "in_progress",
        items: [
          { text: "检查仓库", completed: false },
          { text: "补齐测试", completed: true }
        ]
      }
    });
  });

  it("maps collab tool calls instead of runtime_error", () => {
    const n = createNormalizer(req);
    const [event] = n.map({
      type: "item.started",
      item: {
        id: "collab-1",
        type: "collabToolCall",
        tool: "spawn_agent",
        prompt: "Explore the repo",
        receiver_thread_ids: ["agent-a"]
      } as never
    });
    expect(event).toMatchObject({
      type: "tool.started",
      payload: {
        itemId: "collab-1",
        tool: "spawn_agent",
        prompt: "Explore the repo",
        receiverThreadIds: ["agent-a"]
      }
    });
  });

  it("maps camelCase plan items to update_plan", () => {
    const n = createNormalizer(req);
    const [event] = n.map({
      type: "item.started",
      item: {
        id: "plan-2",
        type: "plan",
        steps: [{ step: "Inspect codebase", status: "in_progress" }]
      } as never
    });
    expect(event).toMatchObject({
      type: "tool.started",
      payload: {
        itemId: "plan-2",
        tool: "update_plan",
        items: [{ step: "Inspect codebase", status: "in_progress" }]
      }
    });
  });

  it("keeps thread error items as runtime_error", () => {
    const n = createNormalizer(req);
    const [event] = n.map({
      type: "item.completed",
      item: { id: "err-1", type: "error", message: "tool failed" }
    });
    expect(event).toMatchObject({
      type: "tool.output",
      payload: { itemId: "err-1", tool: "runtime_error", message: "tool failed" }
    });
  });

  it("does not treat wait without targets as collab", () => {
    const n = createNormalizer(req);
    const [event] = n.map({
      type: "item.started",
      item: {
        id: "pty-wait",
        type: "unknown",
        tool: "wait",
        input: { cell_id: "cell-1", yield_time_ms: 250 }
      } as never
    });
    expect(event).toMatchObject({
      type: "tool.started",
      payload: { itemId: "pty-wait", tool: "wait" }
    });
    expect((event?.payload as { tool?: string }).tool).not.toBe("collab");
  });

  it("still treats wait_agent as collab", () => {
    const n = createNormalizer(req);
    const [event] = n.map({
      type: "item.started",
      item: {
        id: "wait-agent-1",
        type: "unknown",
        tool: "wait_agent",
        targets: ["agent-1"]
      } as never
    });
    expect(event).toMatchObject({
      type: "tool.started",
      payload: {
        itemId: "wait-agent-1",
        tool: "wait_agent",
        receiverThreadIds: ["agent-1"]
      }
    });
  });

  it("maps view_image unknown items to tool view_image", () => {
    const n = createNormalizer(req);
    const [event] = n.map({
      type: "item.started",
      item: {
        id: "img-1",
        type: "unknown",
        name: "view_image",
        path: "/tmp/shot.png"
      } as never
    });
    expect(event).toMatchObject({
      type: "tool.started",
      payload: { itemId: "img-1", tool: "view_image" }
    });
  });

  it("skips empty error placeholders used for unsupported exec items", () => {
    const n = createNormalizer(req);
    expect(
      n.map({
        type: "item.started",
        item: { id: "item_6", type: "error", message: "" }
      })
    ).toEqual([]);
    expect(
      n.map({
        type: "item.completed",
        item: { id: "item_6", type: "error" } as never
      })
    ).toEqual([]);
  });

  it("keeps automatic reconnect attempts non-terminal", () => {
    const n = createNormalizer(req);
    const [event] = n.map({
      type: "error",
      message:
        "Reconnecting... 4/5 (stream disconnected before completion: stream closed before response.completed)"
    });
    expect(event).toMatchObject({
      type: "run.reconnecting",
      payload: {
        status: "running",
        attempt: 4,
        maxAttempts: 5,
        reason: "stream disconnected before completion: stream closed before response.completed"
      }
    });
  });

  it("keeps unrecoverable stream errors terminal", () => {
    const n = createNormalizer(req);
    expect(n.map({ type: "error", message: "connection retries exhausted" })[0]).toMatchObject({
      type: "run.failed",
      payload: { status: "failed", message: "connection retries exhausted" }
    });
  });

  it("treats the final reconnect attempt as terminal and preserves its reason", () => {
    const n = createNormalizer(req);
    expect(
      n.map({
        type: "error",
        message: "Reconnecting... 5/5 (stream disconnected before completion: socket closed)"
      })[0]
    ).toMatchObject({
      type: "run.failed",
      payload: {
        status: "failed",
        message: "stream disconnected before completion: socket closed",
        reason: "stream disconnected before completion: socket closed"
      }
    });
  });

  it("does not classify provider authentication failures as reconnecting", () => {
    const n = createNormalizer(req);
    expect(
      n.map({
        type: "error",
        message: "Reconnecting... 1/5 (401 Unauthorized: invalid API key)"
      })[0]
    ).toMatchObject({
      type: "run.failed",
      payload: {
        status: "failed",
        message: "401 Unauthorized: invalid API key",
        reason: "401 Unauthorized: invalid API key"
      }
    });
  });

  it("does not classify provider rate limits as reconnecting", () => {
    const n = createNormalizer(req);
    expect(
      n.map({ type: "error", message: "429 rate limit exceeded; quota exhausted" })[0]
    ).toMatchObject({
      type: "run.failed",
      payload: { status: "failed", message: "429 rate limit exceeded; quota exhausted" }
    });
  });

  it("keeps a terminal turn failure terminal even when its text mentions reconnecting", () => {
    const n = createNormalizer(req);
    expect(
      n.map({
        type: "turn.failed",
        error: { message: "Reconnecting... 5/5 (all retries exhausted)" }
      })[0]
    ).toMatchObject({
      type: "run.failed",
      payload: { status: "failed", message: "Reconnecting... 5/5 (all retries exhausted)" }
    });
  });

  it("replaces Codex exec stdin banners with the last real failure reason", () => {
    const n = createNormalizer(req);
    expect(
      n.failure(
        new Error("Codex Exec exited with code 1: Reading prompt from stdin...\n"),
        "stream disconnected before completion: stream closed before response.completed"
      )
    ).toMatchObject({
      type: "run.failed",
      payload: {
        status: "failed",
        message: "stream disconnected before completion: stream closed before response.completed"
      }
    });
    expect(n.failure(new Error("Codex Exec exited with code 1: Reading prompt from stdin..."))).toMatchObject({
      type: "run.failed",
      payload: { status: "failed", message: "Codex 进程异常退出（code 1），未返回具体错误信息" }
    });
  });
});

it("includes firstResponseAt on the first visible item event", () => {
  const n = createNormalizer(req);
  const started = n.initial();
  const [delta] = n.map({
    type: "item.updated",
    item: { id: "m1", type: "agent_message", text: "hello" }
  });
  expect(typeof (started.payload as { startedAt?: number }).startedAt).toBe("number");
  expect(delta).toMatchObject({
    type: "assistant.delta",
    payload: {
      itemId: "m1",
      delta: "hello"
    }
  });
  expect(typeof (delta?.payload as { firstResponseAt?: number }).firstResponseAt).toBe("number");
  expect((delta?.payload as { firstResponseAt: number }).firstResponseAt).toBeGreaterThanOrEqual(
    (started.payload as { startedAt: number }).startedAt
  );
});

it("uses an approval request as the first visible response", () => {
  const n = createNormalizer(req);
  const approval = n.approvalRequested({
    approvalId: "approval-1",
    itemId: "command-1",
    tool: "command",
    command: "pnpm test"
  });
  const [completed] = n.map({
    type: "turn.completed",
    usage: {
      input_tokens: 1,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0
    }
  });
  const firstResponseAt = (approval.payload as { firstResponseAt: number }).firstResponseAt;
  expect(typeof firstResponseAt).toBe("number");
  expect(completed?.payload).toMatchObject({ firstResponseAt });
});

it("emits incremental assistant and command patches", () => {
  const n = createNormalizer(req);
  const [first] = n.map({
    type: "item.updated",
    item: { id: "m1", type: "agent_message", text: "hel" }
  });
  const [second] = n.map({
    type: "item.updated",
    item: { id: "m1", type: "agent_message", text: "hello" }
  });
  const [done] = n.map({
    type: "item.completed",
    item: { id: "m1", type: "agent_message", text: "hello" }
  });
  expect(first?.payload).toMatchObject({ delta: "hel" });
  expect(second?.payload).toMatchObject({ delta: "lo" });
  expect((second?.payload as { text?: string }).text).toBeUndefined();
  expect(done).toMatchObject({
    type: "assistant.completed",
    payload: { text: "hello" }
  });
  const [toolFirst] = n.map({
    type: "item.updated",
    item: {
      id: "c1",
      type: "command_execution",
      command: "pwd",
      aggregated_output: "/t",
      status: "in_progress"
    }
  });
  const [toolSecond] = n.map({
    type: "item.updated",
    item: {
      id: "c1",
      type: "command_execution",
      command: "pwd",
      aggregated_output: "/tmp",
      status: "in_progress"
    }
  });
  expect(toolFirst?.payload).toMatchObject({ outputDelta: "/t" });
  expect(toolSecond?.payload).toMatchObject({ outputDelta: "mp" });
});
