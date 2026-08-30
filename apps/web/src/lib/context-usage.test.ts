import { describe, expect, it } from "vitest";
import { parseContextUsage } from "./context-usage";

describe("parseContextUsage", () => {
  it("reads snake_case token counts and context window", () => {
    expect(
      parseContextUsage({
        input_tokens: 8000,
        output_tokens: 3000,
        model_context_window: 258000
      })
    ).toEqual({
      totalTokens: 11000,
      contextWindow: 258000,
      percent: 4,
      label: "11k / 258k",
      title: `上下文 ${Number(11000).toLocaleString()} / ${Number(258000).toLocaleString()} tokens`
    });
  });

  it("reads camelCase totals and window", () => {
    expect(
      parseContextUsage({
        totalTokens: 11000,
        modelContextWindow: 258000
      })
    ).toEqual({
      totalTokens: 11000,
      contextWindow: 258000,
      percent: 4,
      label: "11k / 258k",
      title: `上下文 ${Number(11000).toLocaleString()} / ${Number(258000).toLocaleString()} tokens`
    });
  });

  it("returns null when the context window is missing", () => {
    expect(parseContextUsage({ total_tokens: 11000 })).toBeNull();
    expect(parseContextUsage({ totalTokens: 11000, contextWindow: 0 })).toBeNull();
    expect(parseContextUsage(null)).toBeNull();
    expect(parseContextUsage(undefined)).toBeNull();
  });

  it("caps high usage at 100 percent", () => {
    const high = parseContextUsage({
      totalTokens: 220000,
      contextWindow: 258000
    });
    expect(high).toMatchObject({
      totalTokens: 220000,
      contextWindow: 258000,
      percent: 85,
      label: "220k / 258k"
    });
    expect(high?.percent).toBeGreaterThanOrEqual(80);

    expect(
      parseContextUsage({
        total_tokens: 400000,
        context_window: 258000
      })?.percent
    ).toBe(100);
  });
});
