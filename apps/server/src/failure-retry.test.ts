import { describe, expect, it } from "vitest";
import {
  failureRetryDelayMs,
  failureRetryExhaustedNotice,
  failureRetryingNotice,
  failureRetryLimit,
  failureRetryMaxDelayMs,
  isRetryableTurnFailure
} from "./failure-retry.js";

describe("failure retry classification", () => {
  it("retries provider rate limits and other transient errors", () => {
    expect(
      isRetryableTurnFailure(
        "rate limit exceeded: Your requests to gpt-6-astra for gpt-6-astra-2026-09-03 in westus3 have exceeded rate limit."
      )
    ).toBe(true);
    expect(isRetryableTurnFailure("429 Too Many Requests")).toBe(true);
    expect(isRetryableTurnFailure("stream disconnected before completion: stream closed")).toBe(
      true
    );
    expect(isRetryableTurnFailure("Codex 流在 turn.completed 前结束，任务未完成")).toBe(true);
    expect(isRetryableTurnFailure("turn-timeout")).toBe(true);
  });

  it("does not retry auth, billing or invalid-model errors", () => {
    expect(isRetryableTurnFailure("401 Unauthorized: invalid API key")).toBe(false);
    expect(isRetryableTurnFailure("402 Payment Required")).toBe(false);
    expect(isRetryableTurnFailure("insufficient quota")).toBe(false);
    expect(isRetryableTurnFailure("model grok-4.6 does not exist")).toBe(false);
    expect(isRetryableTurnFailure("upstream failed")).toBe(false);
    expect(isRetryableTurnFailure("")).toBe(false);
  });

  it("backs off retry delay and formats notices", () => {
    expect(failureRetryDelayMs(1, 15_000)).toBe(15_000);
    expect(failureRetryDelayMs(2, 15_000)).toBe(30_000);
    expect(failureRetryDelayMs(3, 15_000)).toBe(60_000);
    expect(failureRetryDelayMs(4, 15_000)).toBe(90_000);
    expect(failureRetryDelayMs(8, 15_000)).toBe(90_000);
    expect(failureRetryDelayMs(4, 15_000, 45_000)).toBe(45_000);
    expect(failureRetryDelayMs(8, 15_000, 180_000)).toBe(180_000);
    expect(failureRetryDelayMs(1, 0)).toBe(0);
    expect(failureRetryMaxDelayMs(undefined)).toBe(90_000);
    expect(failureRetryMaxDelayMs(180_000)).toBe(180_000);
    expect(failureRetryMaxDelayMs(1_000_000)).toBe(600_000);
    expect(failureRetryLimit(2)).toBe(2);
    expect(
      failureRetryingNotice({
        reason: "rate limit exceeded",
        attempt: 1,
        maxAttempts: 30,
        delayMs: 0
      })
    ).toContain("正在自动继续执行（第 1/30 次）");
    expect(
      failureRetryExhaustedNotice({ reason: "rate limit exceeded", maxAttempts: 2 })
    ).toContain("已自动重试 2 次仍未成功");
  });
});
