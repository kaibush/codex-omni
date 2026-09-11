import { describe, expect, it } from "vitest";
import { formatTokenCount, isThreadGoalLocked, threadGoalBannerCopy } from "./thread-goal";

describe("thread-goal helpers", () => {
  it("locks budget and usage limited goals", () => {
    expect(isThreadGoalLocked({ status: "budget_limited" })).toBe(true);
    expect(isThreadGoalLocked({ status: "usage_limited" })).toBe(true);
    expect(isThreadGoalLocked({ status: "active" })).toBe(false);
    expect(isThreadGoalLocked(null)).toBe(false);
  });

  it("formats the banner copy with token usage", () => {
    const copy = threadGoalBannerCopy({
      threadId: "t1",
      goalId: "g1",
      objective: "完成缺思考换号记录表",
      status: "budget_limited",
      tokenBudget: 80_000,
      tokensUsed: 2_352_069,
      timeUsedSeconds: 10,
      createdAt: 1,
      updatedAt: 2
    });
    expect(copy.title).toBe("目标额度已用尽");
    expect(copy.summary).toContain("2,352,069");
    expect(copy.summary).toContain("80,000");
    expect(copy.objective).toBe("完成缺思考换号记录表");
    expect(formatTokenCount(80000)).toBe("80,000");
  });
});
