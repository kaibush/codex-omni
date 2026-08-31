import { describe, expect, it } from "vitest";
import {
  isCoarsePointer,
  chromePointerMovedTooFar,
  isDuplicateChromeClick,
  joinVisibleLines,
  shouldFocusTerminalAfterChromeAction,
  sliceVisibleLines,
  terminalCopyPayload,
  visibleBufferText
} from "./terminal-chrome";

describe("visible buffer extraction", () => {
  const lines = ["one", "two", "three", "four", "five"];

  it("slices the viewport rows without reading past the buffer", () => {
    expect(sliceVisibleLines(lines, 1, 3)).toEqual(["two", "three", "four"]);
    expect(sliceVisibleLines(lines, 4, 8)).toEqual(["five"]);
    expect(sliceVisibleLines(lines, -2, 2)).toEqual(["one", "two"]);
    expect(sliceVisibleLines([], 0, 10)).toEqual([]);
    expect(sliceVisibleLines(lines, 0, 0)).toEqual([]);
  });

  it("joins visible lines and trims trailing blank rows", () => {
    expect(joinVisibleLines(["prompt $", "", ""])).toBe("prompt $");
    expect(visibleBufferText(["a", "b", "c", "", ""], 1, 4)).toBe("b\nc");
    expect(visibleBufferText(["", "", ""], 0, 3)).toBe("");
  });
});

describe("terminal copy payload", () => {
  it("prefers the current selection over the visible screen", () => {
    expect(terminalCopyPayload("selected", "screen")).toEqual({
      text: "selected",
      message: "已复制选中内容"
    });
  });

  it("falls back to the visible screen, then empty", () => {
    expect(terminalCopyPayload("", "screen text")).toEqual({
      text: "screen text",
      message: "已复制当前屏幕"
    });
    expect(terminalCopyPayload("", "")).toEqual({
      text: "",
      message: "没有可复制的内容"
    });
  });
});

describe("should focus terminal after chrome action", () => {
  it("focuses after desktop mouse or keyboard, not touch/pen/coarse", () => {
    expect(shouldFocusTerminalAfterChromeAction({ pointerType: "mouse" })).toBe(true);
    expect(shouldFocusTerminalAfterChromeAction({})).toBe(true);
    expect(shouldFocusTerminalAfterChromeAction({ pointerType: "touch" })).toBe(false);
    expect(shouldFocusTerminalAfterChromeAction({ pointerType: "pen" })).toBe(false);
    expect(
      shouldFocusTerminalAfterChromeAction({ pointerType: "mouse", coarsePointer: true })
    ).toBe(false);
    expect(shouldFocusTerminalAfterChromeAction({ coarsePointer: true })).toBe(false);
  });

  it("reads pointer: coarse from matchMedia", () => {
    expect(isCoarsePointer(() => ({ matches: true }))).toBe(true);
    expect(isCoarsePointer(() => ({ matches: false }))).toBe(false);
    expect(isCoarsePointer(undefined)).toBe(false);
  });

  it("ignores synthetic clicks after a touch/pen pointerdown", () => {
    expect(isDuplicateChromeClick(1, "touch")).toBe(true);
    expect(isDuplicateChromeClick(1, "pen")).toBe(true);
    expect(isDuplicateChromeClick(1, "mouse")).toBe(false);
    expect(isDuplicateChromeClick(0, "touch")).toBe(false);
  });
});

describe("chrome pointer movement", () => {
  it("treats small jitter as a tap and larger swipes as a scroll", () => {
    expect(chromePointerMovedTooFar(100, 106)).toBe(false);
    expect(chromePointerMovedTooFar(100, 120)).toBe(true);
  });
});
