import { describe, expect, it } from "vitest";
import {
  cleanCommand,
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
