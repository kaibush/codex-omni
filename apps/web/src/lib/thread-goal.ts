import type { ThreadGoal } from "@/types";

export type { ThreadGoal, ThreadGoalStatus } from "@/types";

export function isThreadGoalLocked(goal: { status: string } | null | undefined) {
  return goal?.status === "budget_limited" || goal?.status === "usage_limited";
}

export function formatTokenCount(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString("zh-CN");
}

export function threadGoalBannerCopy(goal: ThreadGoal) {
  const used = formatTokenCount(goal.tokensUsed);
  const budget = goal.tokenBudget == null ? "未设置" : formatTokenCount(goal.tokenBudget);
  const title = goal.status === "usage_limited" ? "目标用量已达上限" : "目标额度已用尽";
  const detail =
    goal.status === "usage_limited"
      ? "Codex 不会继续执行新工作，只会收尾总结。"
      : "继续发送也只会收到收尾总结，不会真正执行。";
  return {
    title,
    summary: `${detail}已用 ${used} / ${budget} tokens。清除该目标后，当前对话才能继续干活。`,
    objective: goal.objective.trim()
  };
}
