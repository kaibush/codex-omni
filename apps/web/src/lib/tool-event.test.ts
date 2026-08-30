import { describe, expect, it } from "vitest";
import {
  cleanCommand,
  collabToolLabel,
  isCollabTool,
  isPlanTool,
  parsePlanItems,
  toolCallOutput,
  toolCallRequest,
  toolCallStatusLabel,
  toolCallTitle
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

  it("detects collab tools including mcp names", () => {
    expect(isCollabTool({ tool: "spawn_agent" })).toBe(true);
    expect(isCollabTool({ tool: "mcp__codex__spawn_agent" })).toBe(true);
    expect(isCollabTool({ tool: "command" })).toBe(false);
    expect(collabToolLabel({ tool: "spawn_agent" })).toBe("启动子代理");
  });
});
