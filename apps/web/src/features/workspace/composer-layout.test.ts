import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPOSER_DOCK_CLASS,
  COMPOSER_ICON_BUTTON_CLASS,
  COMPOSER_SHELL_CLASS,
  COMPOSER_TEXTAREA_CLASS,
  COMPOSER_WIDTH_CLASS
} from "./composer-layout";

describe("composer layout", () => {
  it("keeps chat and terminal composers on the same dock and box size", () => {
    expect(COMPOSER_DOCK_CLASS).toContain("composer-dock");
    expect(COMPOSER_DOCK_CLASS).toContain("px-3");
    expect(COMPOSER_DOCK_CLASS).toContain("sm:px-5");
    expect(COMPOSER_DOCK_CLASS).toContain("sm:pb-4");
    expect(COMPOSER_DOCK_CLASS).toContain("lg:px-8");
    expect(COMPOSER_DOCK_CLASS).toContain("safe-area-inset-bottom");
    expect(COMPOSER_WIDTH_CLASS).toBe("chat-content-width mx-auto");
    expect(COMPOSER_SHELL_CLASS).toContain("p-3");
    expect(COMPOSER_SHELL_CLASS).toContain("rounded-2xl");
    expect(COMPOSER_TEXTAREA_CLASS).toContain("field-sizing-fixed");
    expect(COMPOSER_TEXTAREA_CLASS).toContain("min-h-12");
    expect(COMPOSER_TEXTAREA_CLASS).toContain("sm:min-h-14");
    expect(COMPOSER_TEXTAREA_CLASS).toContain("leading-6");
    expect(COMPOSER_ICON_BUTTON_CLASS).toContain("size-8");
  });

  it("is used by both chat and terminal composers", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const chat = readFileSync(join(dir, "WorkspaceComposer.tsx"), "utf8");
    const terminal = readFileSync(join(dir, "TerminalChatPanel.tsx"), "utf8");
    for (const name of [
      "COMPOSER_DOCK_CLASS",
      "COMPOSER_WIDTH_CLASS",
      "COMPOSER_SHELL_CLASS",
      "COMPOSER_TEXTAREA_CLASS"
    ]) {
      expect(chat).toContain(name);
      expect(terminal).toContain(name);
    }
    expect(terminal).toContain("COMPOSER_ICON_BUTTON_CLASS");
    expect(terminal).toContain("terminal-composer-toolbar");
    expect(terminal).toContain("aria-pressed={autoEnter}");
    expect(terminal).not.toContain("<span>隐藏</span>");
    expect(terminal).not.toContain("SelectValue");
    expect(terminal).not.toContain("\n                  快捷");
    expect(terminal).not.toContain("\n                  历史");
  });
});
