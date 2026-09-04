import { describe, expect, it } from "vitest";
import {
  compactJsonData,
  compactTimelineItem,
  previewLimitForKind,
  previewText,
  TIMELINE_PREVIEW_CHARS
} from "./timeline-preview.js";

describe("timeline previews", () => {
  it("keeps short text and trims oversized tool payloads on a line boundary", () => {
    expect(previewText("hello", 20)).toEqual({
      text: "hello",
      truncated: false,
      originalLength: 5
    });
    const result = previewText("one\ntwo\nthree\nfour", 10);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("one\ntwo");
    expect(result.originalLength).toBe(18);
  });

  it("keeps the tail of a live stream so recent lines stay visible", () => {
    const result = previewText("head\nmiddle\ntail", 8, { tail: true });
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("tail");
    expect(result.text).not.toContain("head");
  });

  it("uses a larger budget for assistant replies than tool output", () => {
    expect(previewLimitForKind("tool")).toBe(TIMELINE_PREVIEW_CHARS);
    expect(previewLimitForKind("assistant")).toBeGreaterThan(TIMELINE_PREVIEW_CHARS);
  });

  it("returns the original object when nothing needs trimming", () => {
    const input = { tool: "command", output: "ok" };
    const result = compactJsonData(input);
    expect(result.truncated).toBe(false);
    expect(result.value).toBe(input);
  });

  it("drops streamed deltas and truncates nested diffs without cloning grouped items", () => {
    const items = [{ kind: "tool", text: "keep-ref" }];
    const result = compactJsonData(
      {
        outputDelta: "abc".repeat(100),
        changes: [{ path: "a.ts", diff: "d".repeat(20) }],
        items
      },
      8,
      { skipKeys: ["items"] }
    );
    expect(result.truncated).toBe(true);
    const value = result.value as {
      changes: Array<{ diff: string }>;
      items: typeof items;
      outputDelta?: string;
    };
    expect(value.outputDelta).toBeUndefined();
    expect(value.changes[0]?.diff).toBe("");
    expect(value.items).toBe(items);
  });

  it("bounds nested arrays and the total payload preview", () => {
    const result = compactJsonData({
      items: Array.from({ length: 500 }, (_, index) => ({
        id: index,
        output: "x".repeat(2_000)
      }))
    });
    expect(result.truncated).toBe(true);
    const value = result.value as { items: Array<{ output: string }> };
    expect(value.items.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(value).length).toBeLessThan(70_000);
  });

  it("strips duplicated tool output and flags truncated timeline items", () => {
    const output = `${"line\n".repeat(4000)}tail`;
    const item = {
      kind: "tool",
      text: output,
      data: { tool: "command", output, status: "completed" }
    };
    const result = compactTimelineItem(item);
    expect(result).not.toBe(item);
    expect(result.text?.length).toBeLessThan(output.length);
    expect(result.text).not.toContain("tail");
    expect(result.data).toMatchObject({
      tool: "command",
      status: "completed",
      previewTruncated: true,
      originalLength: output.length
    });
    expect((result.data as { output?: string }).output).toBeUndefined();
  });

  it("can skip preview truncation when loading a single item", () => {
    const output = "x".repeat(20_000);
    const item = { kind: "tool", text: "large output", data: { tool: "command", output } };
    expect(compactTimelineItem(item, { preview: false })).toBe(item);
  });
});
