import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_TITLE,
  joinDocumentTitle,
  workspaceDocumentTitle
} from "./document-title";

describe("joinDocumentTitle", () => {
  it("falls back to the app name", () => {
    expect(joinDocumentTitle([])).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(joinDocumentTitle(["", "   "])).toBe("Codex Omni");
  });

  it("joins specific parts in front of the app name", () => {
    expect(joinDocumentTitle(["系统信息"])).toBe("系统信息 · Codex Omni");
    expect(joinDocumentTitle(["修复登录", "demo"])).toBe("修复登录 · demo · Codex Omni");
  });

  it("skips duplicates of the app name", () => {
    expect(joinDocumentTitle(["Codex Omni"])).toBe("Codex Omni");
    expect(joinDocumentTitle(["修复登录", "Codex Omni"])).toBe("修复登录 · Codex Omni");
  });

  it("collapses whitespace and truncates long parts", () => {
    expect(joinDocumentTitle(["  修   复\n登录  "])).toBe("修 复 登录 · Codex Omni");
    const longTitle = "超长会话标题".repeat(12);
    expect(longTitle.length).toBeGreaterThan(48);
    expect(joinDocumentTitle([longTitle])).toBe(`${longTitle.slice(0, 48).trim()}… · Codex Omni`);
  });
});

describe("workspaceDocumentTitle", () => {
  it("uses the app name when no project is open", () => {
    expect(workspaceDocumentTitle({})).toBe("Codex Omni");
  });

  it("puts the project first, then a named conversation", () => {
    expect(workspaceDocumentTitle({ projectName: "demo" })).toBe("demo");
    expect(
      workspaceDocumentTitle({
        projectName: "demo",
        sessionTitle: "修复登录",
        view: "chat"
      })
    ).toBe("demo - 修复登录");
  });

  it("omits placeholder conversation titles", () => {
    expect(
      workspaceDocumentTitle({
        projectName: "demo",
        sessionTitle: "新对话",
        view: "chat"
      })
    ).toBe("demo");
    expect(
      workspaceDocumentTitle({
        projectName: "demo",
        sessionTitle: "New session",
        view: "chat"
      })
    ).toBe("demo");
  });

  it("labels file, git and terminal views after the project", () => {
    expect(workspaceDocumentTitle({ projectName: "demo", view: "files" })).toBe("demo - 文件");
    expect(
      workspaceDocumentTitle({
        projectName: "demo",
        sessionTitle: "修复登录",
        view: "git"
      })
    ).toBe("demo - Git");
    expect(workspaceDocumentTitle({ projectName: "demo", view: "terminal" })).toBe("demo - 终端");
  });

  it("uses the terminal-chat label until the session is named", () => {
    expect(
      workspaceDocumentTitle({
        projectName: "demo",
        sessionTitle: "新对话",
        view: "terminal-chat"
      })
    ).toBe("demo - 终端对话");
    expect(
      workspaceDocumentTitle({
        projectName: "demo",
        sessionTitle: "修终端滚动",
        view: "terminal-chat"
      })
    ).toBe("demo - 修终端滚动");
  });
});
