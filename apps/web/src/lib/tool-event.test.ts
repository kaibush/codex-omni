import { describe, expect, it } from "vitest";
import {
  classifyRuntimeNotice,
  cleanCommand,
  collabCardDetails,
  collabToolLabel,
  existingPlanTimelineId,
  isCollabTool,
  isPlanTool,
  isRecoverableStreamError,
  isRuntimePlaceholder,
  isUserInputTool,
  isViewImageTool,
  isWriteStdinTool,
  parsePlanItems,
  parseUserInputQuestions,
  toolCallOutput,
  toolCallRequest,
  toolCallStatusLabel,
  toolCallTitle,
  mergeToolEventData,
  viewImagePath,
  writeStdinDetails
} from "./tool-event";

describe("cleanCommand", () => {
  it("unwraps bash -c and leading cd", () => {
    expect(cleanCommand(`bash -c 'cd /tmp && pwd'`)).toBe("pwd");
    expect(cleanCommand("pwd")).toBe("pwd");
  });
});

describe("toolCallRequest", () => {
  it("uses the command invocation rather than output", () => {
    expect(
      toolCallRequest({
        tool: "command",
        command: "pwd",
        output: "/tmp"
      })
    ).toBe("pwd");
  });

  it("formats mcp arguments as the request", () => {
    expect(toolCallRequest({ tool: "mcp__github__search", arguments: { q: "codex" } })).toBe(
      `{
  "q": "codex"
}`
    );
  });
});

describe("toolCallOutput", () => {
  it("uses text or output as the result", () => {
    expect(toolCallOutput({ output: "/tmp" })).toBe("/tmp");
    expect(toolCallOutput({ output: "/tmp" }, "live")).toBe("live");
  });
});

describe("toolCallTitle", () => {
  it("shows the executed command instead of the generic tool name", () => {
    expect(toolCallTitle({ tool: "command", command: "ls -la\n/tmp" })).toBe("ls -la");
    expect(toolCallTitle({ tool: "command" })).toBe("Command");
  });
});

describe("toolCallStatusLabel", () => {
  it("maps runtime statuses", () => {
    expect(toolCallStatusLabel("in_progress")).toBe("进行中");
    expect(toolCallStatusLabel("completed")).toBe("完成");
  });
});

describe("parsePlanItems", () => {
  it("accepts completed booleans and status strings", () => {
    expect(
      parsePlanItems({
        tool: "update_plan",
        items: [
          { text: "检查仓库", completed: true },
          { content: "补齐测试", status: "in_progress" },
          { step: "发布", status: "pending" }
        ]
      })
    ).toEqual([
      { text: "检查仓库", status: "completed" },
      { text: "补齐测试", status: "in_progress" },
      { text: "发布", status: "pending" }
    ]);
  });
});

describe("plan and collab tool detection", () => {
  it("detects plan tools", () => {
    expect(isPlanTool({ tool: "update_plan" })).toBe(true);
    expect(isPlanTool({ tool: "command" })).toBe(false);
  });

  it("reuses the live plan card id for later updates", () => {
    expect(
      existingPlanTimelineId(
        [
          {
            id: "tool-req-plan-start",
            kind: "tool",
            data: {
              tool: "update_plan",
              items: [{ text: "Inspect reports", status: "pending" }]
            }
          }
        ],
        "req",
        {
          tool: "update_plan",
          items: [{ text: "Inspect reports", status: "completed" }]
        }
      )
    ).toBe("tool-req-plan-start");
  });

  it("keeps the richer plan checklist when history overwrites a live card", () => {
    expect(
      mergeToolEventData(
        {
          tool: "update_plan",
          status: "in_progress",
          items: [
            { text: "Inspect reports", status: "completed" },
            { text: "Add summary", status: "pending" }
          ]
        },
        {
          tool: "update_plan",
          status: "in_progress",
          items: [
            { text: "Inspect reports", status: "pending" },
            { text: "Add summary", status: "pending" }
          ]
        }
      )
    ).toMatchObject({
      items: [
        { text: "Inspect reports", status: "completed" },
        { text: "Add summary", status: "pending" }
      ]
    });
  });

  it("recognizes recovered stream disconnect errors", () => {
    expect(
      isRecoverableStreamError({
        kind: "error",
        text: "stream disconnected before completion: stream closed before response.completed"
      })
    ).toBe(true);
    expect(isRecoverableStreamError({ kind: "error", text: "invalid api key" })).toBe(false);
  });

  it("detects collab tools including mcp names", () => {
    expect(isCollabTool({ tool: "spawn_agent" })).toBe(true);
    expect(isCollabTool({ tool: "mcp__codex__spawn_agent" })).toBe(true);
    expect(isCollabTool({ tool: "command" })).toBe(false);
    expect(collabToolLabel({ tool: "spawn_agent" })).toBe("启动子代理");
    expect(isCollabTool({ tool: "wait", input: { cell_id: "none", yield_time_ms: 1000 } })).toBe(
      false
    );
    expect(isCollabTool({ tool: "wait_agent", receiverThreadIds: ["agent-1"] })).toBe(true);
    expect(isCollabTool({ tool: "wait", targets: ["agent-1"] })).toBe(true);
  });
});

describe("collabCardDetails", () => {
  it("extracts spawn nickname and wait results", () => {
    expect(
      collabCardDetails({
        tool: "spawn_agent",
        prompt: "Query the current date",
        output: JSON.stringify({ agent_id: "agent-1", nickname: "Ramanujan" })
      })
    ).toMatchObject({
      prompt: "Query the current date",
      nickname: "Ramanujan",
      receivers: ["agent-1"],
      result: "已启动 Ramanujan"
    });
    expect(
      collabCardDetails({
        tool: "wait_agent",
        receiverThreadIds: ["agent-1"],
        output: JSON.stringify({
          status: { "agent-1": { completed: "Sun Aug 30 05:22:22 UTC 2026" } },
          timed_out: false
        })
      })
    ).toMatchObject({
      receivers: ["agent-1"],
      result: "Sun Aug 30 05:22:22 UTC 2026"
    });
    expect(
      collabCardDetails({
        tool: "close_agent",
        input: { target: "agent-1" },
        output: JSON.stringify({
          previous_status: { completed: "/root/project/github/kaibush/codex-omni" }
        })
      })
    ).toMatchObject({
      receivers: ["agent-1"],
      result: "/root/project/github/kaibush/codex-omni"
    });
  });
});

describe("runtime notices", () => {
  it("classifies metadata, service tier, heads-up and failures", () => {
    expect(
      classifyRuntimeNotice({
        tool: "runtime_error",
        message: "Model metadata for `grok-4.6` not found. Defaulting to fallback metadata."
      })
    ).toMatchObject({ title: "模型提示", level: "warning" });
    expect(
      classifyRuntimeNotice({
        tool: "runtime_error",
        message:
          "Configured service tier `priority` is not advertised as supported for model `grok-4.6`."
      })
    ).toMatchObject({ title: "服务层级", level: "warning" });
    expect(
      classifyRuntimeNotice({
        tool: "runtime_error",
        message:
          "Heads up: Long threads and multiple compactions can cause the model to be less accurate."
      })
    ).toMatchObject({ title: "会话提示", level: "warning" });
    expect(classifyRuntimeNotice({ tool: "runtime_error", message: "tool failed" })).toMatchObject({
      title: "运行失败",
      level: "error"
    });
    expect(classifyRuntimeNotice({ tool: "runtime_error", message: "" })).toBeNull();
    expect(isRuntimePlaceholder({ tool: "runtime_error", message: "" })).toBe(true);
    expect(
      classifyRuntimeNotice(
        { message: "Reconnecting... 2/5 (stream closed before response.completed)" },
        undefined,
        "error"
      )
    ).toBeNull();
  });
});

describe("special tool parsers", () => {
  it("parses request_user_input questions", () => {
    const data = {
      tool: "request_user_input",
      questions: [
        {
          id: "pop3_plan",
          header: "POP3方案",
          question: "你要用哪种方案支持 POP3？",
          options: [{ label: "VPS 邮件服务", description: "部署完整邮件栈" }]
        }
      ]
    };
    expect(isUserInputTool(data)).toBe(true);
    expect(parseUserInputQuestions(data)).toMatchObject([
      { id: "pop3_plan", header: "POP3方案", options: [{ label: "VPS 邮件服务" }] }
    ]);
  });

  it("reads view_image paths and write_stdin details", () => {
    expect(isViewImageTool({ tool: "view_image", path: "/tmp/gamepad.png" })).toBe(true);
    expect(viewImagePath({ tool: "view_image", path: "/tmp/gamepad.png" })).toBe(
      "/tmp/gamepad.png"
    );
    expect(
      viewImagePath({ tool: "view_image", input: { path: "/repo/.codex-uploads/shot.png" } })
    ).toBe("/repo/.codex-uploads/shot.png");
    expect(
      mergeToolEventData(
        { tool: "view_image", input: { path: "/repo/.codex-uploads/shot.png" } },
        { tool: "view_image", phase: "completed", output: "" }
      )
    ).toMatchObject({
      path: "/repo/.codex-uploads/shot.png",
      input: { path: "/repo/.codex-uploads/shot.png" },
      phase: "completed"
    });
    expect(
      writeStdinDetails({
        tool: "write_stdin",
        session_id: 79822,
        chars: "yes\n",
        yield_time_ms: 15000
      })
    ).toMatchObject({ sessionId: "79822", text: "yes\n", yieldTimeMs: 15000 });
    expect(isWriteStdinTool({ tool: "write_stdin" })).toBe(true);
  });
});
