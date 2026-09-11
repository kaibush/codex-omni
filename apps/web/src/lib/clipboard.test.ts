/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyMenuItemProps, copyTextToClipboard } from "./clipboard";

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "platform", { configurable: true, value: "" });
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "" });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
});

describe("copyTextToClipboard", () => {
  it("returns false for empty text", async () => {
    await expect(copyTextToClipboard("")).resolves.toBe(false);
  });

  it("uses the Clipboard API when available", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await expect(copyTextToClipboard("message")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("message");
  });

  it("falls back to execCommand when Clipboard API access is blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("blocked"))) }
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand
    });

    await expect(copyTextToClipboard("code block")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("keeps an iOS fallback inside the Clipboard API gesture", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" });
    const writeText = vi.fn(async () => Promise.reject(new Error("blocked")));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand
    });

    await expect(copyTextToClipboard("ios text")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(writeText).toHaveBeenCalledWith("ios text");
  });

  it("detects iOS from userAgent when platform is empty", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "" });
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"
    });
    const writeText = vi.fn(async () => Promise.reject(new Error("blocked")));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand
    });

    await expect(copyTextToClipboard("ua text")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("keeps the fallback textarea inside the viewport for iOS", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined
    });
    const execCommand = vi.fn(() => {
      const textarea = document.querySelector("textarea");
      expect(textarea).not.toBeNull();
      expect(textarea?.style.left).toBe("0px");
      expect(textarea?.style.top).toBe("0px");
      expect(textarea?.readOnly).toBe(true);
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand
    });

    await expect(copyTextToClipboard("history")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back to a selectable mark when textarea copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined
    });
    const execCommand = vi.fn(() => {
      if (document.querySelector("textarea")) return false;
      const mark = document.querySelector("span[contenteditable='true']");
      expect(mark).not.toBeNull();
      expect(mark?.textContent).toBe("mark text");
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand
    });

    await expect(copyTextToClipboard("mark text")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledTimes(2);
    expect(document.querySelector("span[contenteditable='true']")).toBeNull();
  });
});

describe("copyMenuItemProps", () => {
  it("copies on touch pointerup so iOS keeps the user gesture", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const onDone = vi.fn();
    const props = copyMenuItemProps("session-1", onDone);

    props.onPointerUp({ button: 0, pointerType: "touch" });
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("session-1");
  });

  it("does not recopy when click/select follows the same touch gesture", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const onDone = vi.fn();
    const props = copyMenuItemProps("session-2", onDone);

    props.onPointerUp({ button: 0, pointerType: "touch" });
    props.onClick();
    props.onSelect();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("copies from click for mouse and keyboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const onDone = vi.fn();
    const props = copyMenuItemProps("session-3", onDone);

    props.onPointerUp({ button: 0, pointerType: "mouse" });
    expect(writeText).not.toHaveBeenCalled();
    props.onClick();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(writeText).toHaveBeenCalledWith("session-3");
  });
});
