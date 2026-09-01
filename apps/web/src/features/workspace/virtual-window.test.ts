import { describe, expect, it } from "vitest";
import { estimateTimelineItemSize, shouldVirtualizeTimeline, visibleWindow } from "./virtual-window";

describe("visibleWindow", () => {
  it("returns an empty range for no items", () => {
    expect(
      visibleWindow({
        itemCount: 0,
        itemSize: () => 40,
        scrollTop: 0,
        viewportHeight: 200
      })
    ).toEqual({ start: 0, end: 0, paddingTop: 0, paddingBottom: 0, totalHeight: 0 });
  });

  it("windows a long list around the viewport with overscan", () => {
    const window = visibleWindow({
      itemCount: 100,
      itemSize: () => 50,
      scrollTop: 1000,
      viewportHeight: 200,
      overscan: 2
    });
    expect(window.totalHeight).toBe(5000);
    expect(window.start).toBe(17);
    expect(window.end).toBe(26);
    expect(window.paddingTop).toBe(17 * 50);
    expect(window.paddingBottom).toBe(5000 - window.paddingTop - (window.end - window.start) * 50);
  });

  it("clamps to the last items when pinned near the bottom", () => {
    const window = visibleWindow({
      itemCount: 40,
      itemSize: () => 100,
      scrollTop: 99999,
      viewportHeight: 300,
      overscan: 1
    });
    expect(window.end).toBe(40);
    expect(window.start).toBeGreaterThanOrEqual(35);
    expect(window.paddingTop + window.paddingBottom + (window.end - window.start) * 100).toBe(4000);
  });
});

describe("estimateTimelineItemSize", () => {
  it("sizes user/assistant bubbles from line count and keeps compact rows small", () => {
    expect(estimateTimelineItemSize({ kind: "activity" })).toBe(56);
    expect(estimateTimelineItemSize({ kind: "user", text: "hi" })).toBeGreaterThan(90);
    expect(estimateTimelineItemSize({ kind: "assistant", text: "a\n".repeat(80) })).toBe(1248);
    expect(estimateTimelineItemSize({ kind: "assistant", text: "n".repeat(20_000) })).toBe(1248);
  });
});

describe("shouldVirtualizeTimeline", () => {
  it("keeps short compact threads fully rendered", () => {
    expect(
      shouldVirtualizeTimeline([
        { text: "hi" },
        { text: "hello" },
        { text: "ok" }
      ])
    ).toBe(false);
  });

  it("virtualizes long threads and oversized messages", () => {
    expect(shouldVirtualizeTimeline(Array.from({ length: 12 }, () => ({ text: "x" })))).toBe(true);
    expect(shouldVirtualizeTimeline([{ text: "n".repeat(9000) }])).toBe(true);
    expect(shouldVirtualizeTimeline([{ text: "a".repeat(7000) }, { text: "b".repeat(7000) }])).toBe(
      true
    );
  });
});
