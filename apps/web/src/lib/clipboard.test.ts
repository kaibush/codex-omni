/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyMenuItemProps,
  copyTextToClipboard,
  isIosDevice,
  preventIosMenuAutoFocus
} from "./clipboard";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(navigator, "platform", { configurable: true, value: "" });
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "" });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
});

function mockCopyCommand(handler: () => boolean) {
  const execCommand = vi.fn(() => {
    const event = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { setData: vi.fn() }
    });
    document.dispatchEvent(event);
    return handler();
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand
  });
  return execCommand;
}

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
    const execCommand = mockCopyCommand(() => true);

    await expect(copyTextToClipboard("code block")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("does not trust Clipboard API success on iOS", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const execCommand = mockCopyCommand(() => true);

    await expect(copyTextToClipboard("ios text")).resolves.toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("detects iOS from userAgent when platform is empty", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "" });
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const execCommand = mockCopyCommand(() => true);

    expect(isIosDevice()).toBe(true);
    await expect(copyTextToClipboard("ua text")).resolves.toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("keeps the fallback textarea inside the viewport", async () => {
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

  it("uses an editable textarea on iOS instead of a readonly one", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined
    });
    const execCommand = mockCopyCommand(() => {
      const textarea = document.querySelector("textarea");
      expect(textarea).not.toBeNull();
      expect(textarea?.readOnly).toBe(false);
      expect(textarea?.contentEditable).toBe("true");
      expect(textarea?.value).toBe("sid");
      return true;
    });

    await expect(copyTextToClipboard("sid")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("does not treat iOS execCommand success as copied without a copy event", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => true)
    });

    await expect(copyTextToClipboard("empty pasteboard")).resolves.toBe(false);
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

  it("writes text/plain through the copy event", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined
    });
    const setData = vi.fn();
    const execCommand = vi.fn(() => {
      const event = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", {
        value: { setData }
      });
      document.dispatchEvent(event);
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand
    });

    await expect(copyTextToClipboard("session-id")).resolves.toBe(true);
    expect(setData).toHaveBeenCalledWith("text/plain", "session-id");
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

  it("keeps the iOS menu open so focus restore cannot clear the pasteboard", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" });
    mockCopyCommand(() => true);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("session-4");
    const preventDefault = vi.fn();
    const props = copyMenuItemProps("session-4");
    props.onSelect({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("falls back to a prompt on iOS when the pasteboard write cannot be confirmed", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => true)
    });
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("session-5");
    const onDone = vi.fn();
    const props = copyMenuItemProps("session-5", onDone);
    props.onPointerUp({ button: 0, pointerType: "touch" });
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(prompt).toHaveBeenCalledWith("请长按全选后复制", "session-5");
  });
});

describe("preventIosMenuAutoFocus", () => {
  it("prevents close auto-focus on iOS", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" });
    const event = { preventDefault: vi.fn() } as unknown as Event;
    preventIosMenuAutoFocus(event);
    expect(
      (event as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault
    ).toHaveBeenCalled();
  });

  it("does not prevent close auto-focus on desktop", () => {
    const event = { preventDefault: vi.fn() } as unknown as Event;
    preventIosMenuAutoFocus(event);
    expect(
      (event as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault
    ).not.toHaveBeenCalled();
  });
});
