import { describe, expect, it } from "vitest";
import { estimateTimelineItemSize, shouldVirtualizeTimeline, stickyVisibleRange, visibleWindow } from "./virtual-window";

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

  it("extends the window by pixel overscan so fast scrolling stays filled", () => {
    const window = visibleWindow({
      itemCount: 100,
      itemSize: () => 50,
      scrollTop: 1000,
      viewportHeight: 200,
      overscan: 0,
      overscanPx: 150
    });
    expect(window.start).toBe(16);
    expect(window.end).toBe(27);
    expect(window.paddingTop).toBe(16 * 50);
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
  it("keeps unmeasured bubbles compact so scroll gaps stay small", () => {
    expect(estimateTimelineItemSize({ kind: "activity" })).toBe(52);
    expect(estimateTimelineItemSize({ kind: "user", text: "hi" })).toBeGreaterThan(90);
    expect(estimateTimelineItemSize({ kind: "assistant", text: "a\n".repeat(80) })).toBe(212);
    expect(estimateTimelineItemSize({ kind: "assistant", text: "n".repeat(20_000) })).toBe(212);
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

describe("stickyVisibleRange", () => {
  it("keeps the union of nearby windows so scrolling does not unmount cards", () => {
    expect(stickyVisibleRange({ start: 12, end: 20 }, { start: 10, end: 18 })).toEqual({
      start: 10,
      end: 20
    });
  });

  it("drops the sticky range after a jump and caps how many cards stay mounted", () => {
    expect(stickyVisibleRange({ start: 80, end: 90 }, { start: 0, end: 12 })).toEqual({
      start: 80,
      end: 90
    });
    const shrunk = stickyVisibleRange({ start: 40, end: 50 }, { start: 0, end: 80 }, 20);
    expect(shrunk.start).toBeGreaterThanOrEqual(30);
    expect(shrunk.end).toBeLessThanOrEqual(60);
    expect(shrunk.end - shrunk.start).toBeLessThanOrEqual(20);
    expect(shrunk.start).toBeLessThanOrEqual(40);
    expect(shrunk.end).toBeGreaterThanOrEqual(50);
  });

  it("defaults to keeping at most 18 sticky cards", () => {
    const shrunk = stickyVisibleRange({ start: 40, end: 50 }, { start: 0, end: 80 });
    expect(shrunk.end - shrunk.start).toBeLessThanOrEqual(18);
    expect(shrunk.start).toBeLessThanOrEqual(40);
    expect(shrunk.end).toBeGreaterThanOrEqual(50);
  });
});
