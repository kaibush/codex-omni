import { describe, expect, it } from "vitest";
import { summarizeMessageText } from "./message-summary";

describe("message summary", () => {
  it("uses headings when present", () => {
    const result = summarizeMessageText("# 计划\n\n细节\n\n## 步骤\n\n- 做 A");
    expect(result.title).toBe("计划");
    expect(result.content).toContain("- 计划");
    expect(result.content).toContain("- 步骤");
  });

  it("falls back to paragraphs", () => {
    const result = summarizeMessageText("第一段说明。\n\n第二段补充。");
    expect(result.title).toContain("第一段");
    expect(result.content).toContain("第一段说明");
  });
});
