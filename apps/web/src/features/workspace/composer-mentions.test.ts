import { describe, expect, it } from "vitest";
import {
  expandSlashCommand,
  extractMentions,
  insertAt,
  mentionQuery,
  slashQuery
} from "./composer-mentions";

describe("composer mentions", () => {
  it("expands slash commands and keeps extra instructions", () => {
    expect(expandSlashCommand("/review")).toContain("审查");
    expect(expandSlashCommand("/test 只跑 web")).toContain("只跑 web");
    expect(expandSlashCommand("hello")).toBe("hello");
    expect(
      expandSlashCommand(
        "/note 补测试",
        [{ name: "/note", title: "笔记", prompt: "项目 {{project}}：{{input}}" }],
        { projectName: "demo" }
      )
    ).toBe("项目 demo：补测试");
  });

  it("detects @file queries and extracts mention paths", () => {
    expect(mentionQuery("see @src/a", "see @src/a".length)).toEqual({ start: 4, query: "src/a" });
    expect(mentionQuery("see @src/a more", 15)).toBeNull();
    expect(extractMentions("look at @src/a.ts and @docs/readme.md")).toEqual([
      "src/a.ts",
      "docs/readme.md"
    ]);
    expect(insertAt("see @sr", 4, 7, "@src/index.ts ")).toBe("see @src/index.ts ");
    expect(slashQuery("/re", 3)).toBe("/re");
    expect(slashQuery(" /re", 4)).toBeNull();
  });
});
