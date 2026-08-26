import { describe, expect, it } from "vitest";
import {
  applyPlanMode,
  applyProjectRules,
  parsePlanTasks,
  summarizeRuns
} from "./workspace-loop.js";

describe("workspace loop", () => {
  it("parses checkbox and numbered plan tasks", () => {
    expect(
      parsePlanTasks(`## 任务
- [ ] 修复分页
- [x] 已完成的不要重复
1. 增加检查点
2. 增加检查点
`)
    ).toEqual(["修复分页", "已完成的不要重复", "增加检查点"]);
  });

  it("prefixes plan mode once and summarizes run usage", () => {
    const planned = applyPlanMode("请重构搜索");
    expect(planned).toContain("请先制定可执行计划");
    expect(applyPlanMode(planned)).toBe(planned);
    expect(
      summarizeRuns([
        {
          status: "completed",
          startedAt: 1000,
          endedAt: 2500,
          usageJson: JSON.stringify({ input_tokens: 10, output_tokens: 5, total_tokens: 15 })
        },
        { status: "failed", startedAt: 3000, endedAt: 3200, usageJson: null }
      ])
    ).toMatchObject({
      turns: 2,
      completed: 1,
      failed: 1,
      durationMs: 1700,
      totalTokens: 15
    });
  });
});

describe("applyProjectRules", () => {
  it("prepends enabled project rules", () => {
    expect(
      applyProjectRules("请修复分页", [{ title: "测试约定", content: "先跑测试再提交" }])
    ).toContain("<project-rules>");
    expect(applyProjectRules("hello", [])).toBe("hello");
  });
});
