import { describe, expect, it } from "vitest";
import {
  continuationRetryDirective,
  incompleteTurnReason,
  isPlanOnlyResponse
} from "./turn-completion.js";

const defaults = {
  message: "私库构建的时候报错了",
  planMode: false,
  continuationApplied: false,
  assistantText: "先看你贴的构建报错图，再对照私库的 workflow 和最近合入的代码。",
  latestAssistantText: "先看你贴的构建报错图，再对照私库的 workflow 和最近合入的代码。",
  hasExecutionEvidence: false,
  compactedThisTurn: false,
  hasPostCompactionExecution: false
};

describe("task completion guard", () => {
  it("detects the original plan-only build turn, not just a continue trigger", () => {
    expect(incompleteTurnReason(defaults)).toBe("plan-only");
    expect(incompleteTurnReason({ ...defaults, message: "继续", continuationApplied: true })).toBe(
      "continuation"
    );
  });

  it("checks the tail after compaction even if there was execution before it", () => {
    expect(
      incompleteTurnReason({
        ...defaults,
        assistantText: "earlier execution ".repeat(200),
        latestAssistantText: "先核对截图和审计页现状，确认用户原文是否已经接上。",
        hasExecutionEvidence: true,
        compactedThisTurn: true
      })
    ).toBe("compaction");
    expect(
      incompleteTurnReason({
        ...defaults,
        hasExecutionEvidence: true,
        compactedThisTurn: true,
        hasPostCompactionExecution: true
      })
    ).toBeUndefined();
  });

  it.each([
    "已完成修改，测试通过。",
    "我已经完成了检查；下一步你可以部署。",
    "请提供报错截图，我再继续。",
    "我先确认一下：你指的是哪个分支？",
    "建议你先看 workflow。",
    "先看配置。\n1. 检查权限\n2. 查看日志",
    "具体命令：\n```sh\npnpm test\n```"
  ])("leaves results, questions and requested advice alone: %s", (text) => {
    expect(isPlanOnlyResponse(text)).toBe(false);
  });

  it.each(["先给出修复计划，不要执行", "只解释构建失败的原因", "Plan only, do not modify files"])(
    "does not turn planning into execution: %s",
    (message) => {
      expect(incompleteTurnReason({ ...defaults, message })).toBeUndefined();
    }
  );

  it("respects plan mode and requires the right retry reason", () => {
    expect(incompleteTurnReason({ ...defaults, planMode: true })).toBeUndefined();
    expect(continuationRetryDirective("compaction")).toContain("压缩上下文");
    expect(continuationRetryDirective("plan-only")).toContain("只在原请求要求修改时");
  });
});
