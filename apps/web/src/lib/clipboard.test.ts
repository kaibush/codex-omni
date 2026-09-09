/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("copyTextToClipboard", () => {
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
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand
    });

    await expect(copyTextToClipboard("history")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
