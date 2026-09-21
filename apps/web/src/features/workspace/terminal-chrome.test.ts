/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import {
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_FONT_SIZE_STORAGE_KEY,
  canDecreaseTerminalFontSize,
  canFitTerminal,
  canIncreaseTerminalFontSize,
  clampTerminalFontSize,
  defaultTerminalFontSize,
  loadTerminalFontSize,
  persistTerminalFontSize,
  stepTerminalFontSize,
  isCoarsePointer,
  chromePointerMovedTooFar,
  composeTerminalAttachmentCommand,
  encodeTerminalComposerChunks,
  encodeTerminalComposerPayload,
  encodeTerminalKeyboardSubmit,
  encodeTerminalModifiedInput,
  filterCommandHistory,
  quoteShellArg,
  isDuplicateChromeClick,
  isTouchLikePointer,
  joinVisibleLines,
  refreshTerminal,
  scheduleTerminalFit,
  shouldFocusTerminalAfterChromeAction,
  shouldPreventChromePointerDefault,
  shouldResetTerminalSnapshot,
  shouldSubmitTerminalKeyboard,
  sliceVisibleLines,
  terminalCopyPayload,
  terminalFontSize,
  terminalKeepaliveClassName,
  terminalKeyboardFieldProps,
  touchScrollLines,
  visibleBufferText,
  xtermTheme
} from "./terminal-chrome";

describe("terminal density", () => {
  it("uses a compact font so more rows fit on phone and desktop", () => {
    expect(terminalFontSize(390)).toBe(11);
    expect(terminalFontSize(1280)).toBe(12);
    expect(defaultTerminalFontSize(390)).toBe(11);
    expect(defaultTerminalFontSize(1280)).toBe(12);
  });

  it("does not fit or resize a hidden terminal", () => {
    expect(canFitTerminal(800, 600)).toBe(true);
    expect(canFitTerminal(0, 600)).toBe(false);
    expect(canFitTerminal(800, 0)).toBe(false);
    expect(canFitTerminal(8, 8)).toBe(false);
  });

  it("keeps inactive terminals sized instead of display-none", () => {
    expect(terminalKeepaliveClassName(true)).toContain("relative");
    expect(terminalKeepaliveClassName(false)).toContain("invisible");
    expect(terminalKeepaliveClassName(false)).toContain("absolute");
    expect(terminalKeepaliveClassName(false)).toContain("h-full");
    expect(terminalKeepaliveClassName(false).split(/\s+/)).not.toContain("hidden");
  });
});

describe("terminal font size", () => {
  beforeEach(() => {
    localStorage.removeItem(TERMINAL_FONT_SIZE_STORAGE_KEY);
  });

  it("clamps finite sizes and rejects invalid numbers", () => {
    expect(clampTerminalFontSize(Number.NaN)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(clampTerminalFontSize(Number.POSITIVE_INFINITY)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(clampTerminalFontSize(Number.NEGATIVE_INFINITY)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(clampTerminalFontSize(0)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(clampTerminalFontSize(100)).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(clampTerminalFontSize(14)).toBe(14);
  });

  it("steps by one until the min and max", () => {
    expect(stepTerminalFontSize(12, 1)).toBe(13);
    expect(stepTerminalFontSize(12, -1)).toBe(11);
    expect(stepTerminalFontSize(TERMINAL_FONT_SIZE_MIN, -1)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(stepTerminalFontSize(TERMINAL_FONT_SIZE_MAX, 1)).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(canDecreaseTerminalFontSize(TERMINAL_FONT_SIZE_MIN)).toBe(false);
    expect(canIncreaseTerminalFontSize(TERMINAL_FONT_SIZE_MIN)).toBe(true);
    expect(canDecreaseTerminalFontSize(TERMINAL_FONT_SIZE_MAX)).toBe(true);
    expect(canIncreaseTerminalFontSize(TERMINAL_FONT_SIZE_MAX)).toBe(false);
  });

  it("loads a stored size and falls back when the value is invalid", () => {
    expect(loadTerminalFontSize(390)).toBe(11);
    localStorage.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, "nope");
    expect(loadTerminalFontSize(390)).toBe(11);
    localStorage.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, "");
    expect(loadTerminalFontSize(1280)).toBe(12);
    localStorage.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, "16");
    expect(loadTerminalFontSize(390)).toBe(16);
    persistTerminalFontSize(99);
    expect(localStorage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY)).toBe(String(TERMINAL_FONT_SIZE_MAX));
    expect(loadTerminalFontSize(390)).toBe(TERMINAL_FONT_SIZE_MAX);
  });
});

describe("terminal snapshot reset", () => {
  it("resets when replay is incomplete or the PTY pid changed", () => {
    expect(shouldResetTerminalSnapshot({ replay: false })).toBe(true);
    expect(shouldResetTerminalSnapshot({ replay: true, truncated: true })).toBe(true);
    expect(shouldResetTerminalSnapshot({ replay: true, previousPid: 1, nextPid: 2 })).toBe(true);
    expect(shouldResetTerminalSnapshot({ replay: true, previousPid: 1, nextPid: null })).toBe(true);
    expect(shouldResetTerminalSnapshot({ replay: true, previousPid: 7, nextPid: 7 })).toBe(false);
  });
});

describe("terminal fit helpers", () => {
  it("refreshes the visible rows when the renderer is ready", () => {
    const refresh: Array<[number, number]> = [];
    const atlas: boolean[] = [];
    refreshTerminal({
      rows: 24,
      refresh: (start, end) => { refresh.push([start, end]); },
      clearTextureAtlas: () => { atlas.push(true); }
    });
    expect(atlas).toEqual([true]);
    expect(refresh).toEqual([[0, 23]]);
  });

  it("schedules fit after two animation frames", () => {
    const frames: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    try {
      const calls: string[] = [];
      const cancel = scheduleTerminalFit(() => calls.push("fit"), () => calls.push("ready"));
      expect(frames).toHaveLength(1);
      frames[0]!(0);
      expect(frames).toHaveLength(2);
      frames[1]!(0);
      expect(calls).toEqual(["fit", "ready"]);
      cancel();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  });
});

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

describe("touch chrome scrolling", () => {
  it("does not preventDefault on touch/pen so iOS can pan the key row", () => {
    expect(isTouchLikePointer("touch")).toBe(true);
    expect(isTouchLikePointer("pen")).toBe(true);
    expect(isTouchLikePointer("mouse")).toBe(false);
    expect(shouldPreventChromePointerDefault("touch")).toBe(false);
    expect(shouldPreventChromePointerDefault("pen")).toBe(false);
    expect(shouldPreventChromePointerDefault("mouse")).toBe(true);
    expect(shouldPreventChromePointerDefault(undefined)).toBe(true);
  });
});

describe("terminal keyboard field", () => {
  it("uses iOS text-field attributes for CJK and the send key", () => {
    expect(terminalKeyboardFieldProps).toMatchObject({
      type: "text",
      inputMode: "text",
      enterKeyHint: "send",
      autoCapitalize: "none",
      autoCorrect: "off",
      autoComplete: "off",
      spellCheck: false,
      lang: "zh-CN"
    });
  });

  it("submits on Enter but not while composing Chinese", () => {
    expect(shouldSubmitTerminalKeyboard({ key: "Enter" })).toBe(true);
    expect(shouldSubmitTerminalKeyboard({ key: "Enter", shiftKey: true })).toBe(false);
    expect(shouldSubmitTerminalKeyboard({ key: "Enter", isComposing: true })).toBe(false);
    expect(shouldSubmitTerminalKeyboard({ key: "Enter", nativeEvent: { isComposing: true } })).toBe(
      false
    );
    expect(shouldSubmitTerminalKeyboard({ key: "Enter", keyCode: 229 })).toBe(false);
    expect(shouldSubmitTerminalKeyboard({ key: "a" })).toBe(false);
  });

  it("sends a carriage return after typed text", () => {
    expect(encodeTerminalKeyboardSubmit("")).toBe("\r");
    expect(encodeTerminalKeyboardSubmit("ls")).toBe("ls\r");
    expect(encodeTerminalKeyboardSubmit("echo hi\n")).toBe("echo hi\r");
    expect(encodeTerminalKeyboardSubmit("one\ntwo")).toBe("one\rtwo\r");
  });

  it("can send composer text without auto-enter", () => {
    expect(encodeTerminalComposerPayload("ls")).toBe("ls\r");
    expect(encodeTerminalComposerPayload("ls", true)).toBe("ls\r");
    expect(encodeTerminalComposerPayload("ls", false)).toBe("ls");
    expect(encodeTerminalComposerPayload("one\ntwo", false)).toBe("one\rtwo");
    expect(encodeTerminalComposerPayload("ls\n", false)).toBe("ls");
    expect(encodeTerminalComposerPayload("one\ntwo\n", false)).toBe("one\rtwo");
    expect(encodeTerminalComposerPayload("", false)).toBe("");
    expect(encodeTerminalComposerPayload("", true)).toBe("\r");
  });

  it("splits auto-enter into a delayed carriage return", () => {
    expect(encodeTerminalComposerChunks("ls")).toEqual(["ls", "\r"]);
    expect(encodeTerminalComposerChunks("ls", true)).toEqual(["ls", "\r"]);
    expect(encodeTerminalComposerChunks("ls", false)).toEqual(["ls"]);
    expect(encodeTerminalComposerChunks("one\ntwo", true)).toEqual(["one\rtwo", "\r"]);
    expect(encodeTerminalComposerChunks("ls\n", true)).toEqual(["ls", "\r"]);
    expect(encodeTerminalComposerChunks("", true)).toEqual(["\r"]);
    expect(encodeTerminalComposerChunks("", false)).toEqual([]);
  });

  it("encodes latched Ctrl/Alt/Shift onto the next character", () => {
    expect(encodeTerminalModifiedInput("a")).toBe("a");
    expect(encodeTerminalModifiedInput("a", { ctrl: true })).toBe("\x01");
    expect(encodeTerminalModifiedInput("A", { ctrl: true })).toBe("\x01");
    expect(encodeTerminalModifiedInput("a", { shift: true })).toBe("A");
    expect(encodeTerminalModifiedInput("a", { alt: true })).toBe("\x1ba");
    expect(encodeTerminalModifiedInput("a", { ctrl: true, alt: true })).toBe("\x1b\x01");
    expect(encodeTerminalModifiedInput("\x1b[A", { shift: true })).toBe("\x1b[1;2A");
    expect(encodeTerminalModifiedInput("\x1b[A", { ctrl: true })).toBe("\x1b[1;5A");
    expect(encodeTerminalModifiedInput("\t", { shift: true })).toBe("\x1b[Z");
    expect(encodeTerminalModifiedInput("[", { ctrl: true })).toBe("\x1b");
    expect(encodeTerminalModifiedInput("中", { ctrl: true })).toBe("中");
  });
});

describe("terminal attachment paths", () => {
  it("quotes shell arguments only when needed", () => {
    expect(quoteShellArg("")).toBe("''");
    expect(quoteShellArg("ls")).toBe("ls");
    expect(quoteShellArg(".codex-uploads/1-a.md")).toBe(".codex-uploads/1-a.md");
    expect(quoteShellArg("my file.txt")).toBe("'my file.txt'");
    expect(quoteShellArg("it's")).toBe("'it'\\''s'");
  });

  it("inserts uploaded paths instead of executing a bare file", () => {
    expect(composeTerminalAttachmentCommand("", [".codex-uploads/1-a.md"])).toEqual({
      command: ".codex-uploads/1-a.md",
      submit: false
    });
    expect(composeTerminalAttachmentCommand("cat", [".codex-uploads/1-a.md"])).toEqual({
      command: "cat .codex-uploads/1-a.md",
      submit: true
    });
    expect(
      composeTerminalAttachmentCommand("cat .codex-uploads/1-a.md", [".codex-uploads/1-a.md"])
    ).toEqual({
      command: "cat .codex-uploads/1-a.md",
      submit: true
    });
    expect(composeTerminalAttachmentCommand("", ["my file.txt"])).toEqual({
      command: "'my file.txt'",
      submit: false
    });
    expect(composeTerminalAttachmentCommand("python", ["my file.txt"])).toEqual({
      command: "python 'my file.txt'",
      submit: true
    });
  });
});

describe("command history search", () => {
  const items = ["git status", "git log --oneline", "ls -la", "npm test"];

  it("returns the newest items first up to the limit", () => {
    expect(filterCommandHistory(items, "", 2)).toEqual(["git status", "git log --oneline"]);
  });

  it("filters by substring without changing order", () => {
    expect(filterCommandHistory(items, "GIT")).toEqual(["git status", "git log --oneline"]);
    expect(filterCommandHistory(items, "  test ")).toEqual(["npm test"]);
  });
});

describe("xterm theme", () => {
  it("uses a light canvas in light mode and a dark canvas in dark mode", () => {
    expect(xtermTheme("light").background).toBe("#fbfdff");
    expect(xtermTheme("light").foreground).toBe("#172033");
    expect(xtermTheme("dark").background).toBe("#090d14");
    expect(xtermTheme("dark").foreground).toBe("#dce5f2");
  });
});

describe("touch scroll", () => {
  it("turns finger movement into whole terminal lines and keeps the remainder", () => {
    expect(touchScrollLines(20, 10, 0)).toEqual({ lines: 2, leftover: 0 });
    expect(touchScrollLines(6, 10, 0)).toEqual({ lines: 0, leftover: 0.6 });
    const accumulated = touchScrollLines(6, 10, 0.6);
    expect(accumulated.lines).toBe(1);
    expect(accumulated.leftover).toBeCloseTo(0.2);
    const backward = touchScrollLines(-12, 10, 0);
    expect(backward.lines).toBe(-1);
    expect(backward.leftover).toBeCloseTo(-0.2);
  });
});
