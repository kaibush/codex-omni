import { describe, expect, it } from "vitest";
import {
  defaultFailureRetrySettings,
  failureRetryDelayMs,
  failureRetryKeywords,
  failureRetrySettingsSchema,
  isRetryableTurnFailure,
  matchFailureRetry,
  RESOURCE_MISMATCH_RETRY_KEYWORD
} from "./failure-retry.js";

const resourceMismatch = JSON.stringify({
  error: {
    message:
      "OpenAI Responses bad request: The requested item was created under a different *** OpenAI resource. Use the same resource that created the item to access it.",
    type: "invalid_request_error",
    code: null
  }
});

describe("configurable failure retry policy", () => {
  it("keeps the legacy classification and delay when new settings are absent", () => {
    const legacy = failureRetrySettingsSchema.partial().parse({
      failureRetryEnabled: true,
      failureRetryMaxAttempts: 7,
      failureRetryDelayMs: 20_000,
      failureRetryMaxDelayMs: 70_000
    });
    const settings = { ...defaultFailureRetrySettings, ...legacy };
    expect(settings.failureRetryMode).toBe("builtin");
    expect(settings.failureRetryMaxAttempts).toBe(7);
    expect(isRetryableTurnFailure("429 Too Many Requests", legacy)).toBe(true);
    expect(isRetryableTurnFailure("401 Unauthorized; network error", legacy)).toBe(false);
    expect(isRetryableTurnFailure(resourceMismatch, legacy)).toBe(false);
    expect(
      failureRetryDelayMs(
        4,
        settings.failureRetryDelayMs,
        settings.failureRetryMaxDelayMs,
        settings.failureRetryBackoff
      )
    ).toBe(70_000);
  });

  it("allows the screenshot error to override bad-request exclusions with an explicit keyword", () => {
    const settings = {
      failureRetryIncludeKeywords: `\n  ${RESOURCE_MISMATCH_RETRY_KEYWORD}\r\n upstream busy \n`
    };
    expect(matchFailureRetry(resourceMismatch, settings)).toEqual({
      retry: true,
      source: "include",
      keyword: RESOURCE_MISMATCH_RETRY_KEYWORD
    });
    expect(isRetryableTurnFailure(resourceMismatch.toUpperCase(), settings)).toBe(true);
    expect(isRetryableTurnFailure("400 bad request: unrelated invalid parameter", settings)).toBe(
      false
    );
    expect(isRetryableTurnFailure("503 Service Unavailable", settings)).toBe(true);
    expect(isRetryableTurnFailure("401 Unauthorized", settings)).toBe(false);
  });

  it.each(["builtin", "custom", "all"] as const)(
    "gives exclusions priority in %s mode",
    (failureRetryMode) => {
      expect(
        matchFailureRetry(resourceMismatch, {
          failureRetryMode,
          failureRetryIncludeKeywords: RESOURCE_MISMATCH_RETRY_KEYWORD,
          failureRetryExcludeKeywords: "\n  different *** OpenAI resource \n"
        })
      ).toEqual({ retry: false, source: "exclude", keyword: "different *** OpenAI resource" });
    }
  );

  it("only retries explicit keyword matches in custom mode", () => {
    const settings = {
      failureRetryMode: "custom" as const,
      failureRetryIncludeKeywords: "upstream busy"
    };
    expect(isRetryableTurnFailure("429 Too Many Requests", settings)).toBe(false);
    expect(isRetryableTurnFailure("error: upstream busy", settings)).toBe(true);
    expect(
      isRetryableTurnFailure("upstream busy", { ...settings, failureRetryIncludeKeywords: " \n" })
    ).toBe(false);
  });

  it("lets all mode retry unknown, auth, and empty failures, while respecting exclusions", () => {
    for (const reason of ["unknown upstream failure", "401 Unauthorized", "", undefined]) {
      expect(isRetryableTurnFailure(reason, { failureRetryMode: "all" })).toBe(true);
    }
    expect(
      isRetryableTurnFailure("401 Unauthorized", {
        failureRetryMode: "all",
        failureRetryExcludeKeywords: "401"
      })
    ).toBe(false);
  });

  it("treats keywords literally, ignores blank lines, and handles malformed legacy values", () => {
    expect(failureRetryKeywords(" timeout \r\n\ntimeout\n [error].* ")).toEqual([
      "timeout",
      "[error].*"
    ]);
    expect(
      isRetryableTurnFailure("unrelated", {
        failureRetryMode: "custom",
        failureRetryIncludeKeywords: ".*"
      })
    ).toBe(false);
    expect(isRetryableTurnFailure("[error].*", { failureRetryIncludeKeywords: "[error].*" })).toBe(
      true
    );
    expect(failureRetryKeywords(null)).toEqual([]);
    expect(matchFailureRetry("", {})).toEqual({ retry: false, source: "empty" });
  });

  it("rejects invalid API settings and accepts old partial payloads", () => {
    expect(failureRetrySettingsSchema.partial().parse({ failureRetryEnabled: true })).toEqual({
      failureRetryEnabled: true
    });
    for (const invalid of [
      { failureRetryMode: "unknown" },
      { failureRetryBackoff: "random" },
      { failureRetryIncludeKeywords: ["timeout"] },
      { failureRetryExcludeKeywords: "x".repeat(8_001) },
      { failureRetryMaxAttempts: 0 },
      { failureRetryDelayMs: -1 },
      { failureRetryMaxDelayMs: 600_001 }
    ])
      expect(failureRetrySettingsSchema.partial().safeParse(invalid).success).toBe(false);
  });
});

describe("retry wait strategies", () => {
  it.each([
    ["exponential", [15_000, 30_000, 60_000, 90_000, 90_000]],
    ["fixed", [15_000, 15_000, 15_000, 15_000, 15_000]],
    ["linear", [15_000, 30_000, 45_000, 60_000, 75_000]]
  ] as const)("calculates %s waits", (backoff, expected) => {
    expect(
      [1, 2, 3, 4, 5].map((attempt) => failureRetryDelayMs(attempt, 15_000, 90_000, backoff))
    ).toEqual(expected);
  });

  it.each(["exponential", "fixed", "linear"] as const)(
    "honors zero and capped waits with %s",
    (backoff) => {
      expect(failureRetryDelayMs(100, 15_000, 10_000, backoff)).toBe(10_000);
      expect(failureRetryDelayMs(100, 0, 90_000, backoff)).toBe(0);
      expect(failureRetryDelayMs(100, 15_000, 0, backoff)).toBe(0);
      expect(failureRetryDelayMs(NaN, 15_000, 90_000, backoff)).toBe(15_000);
    }
  );
});
