import { describe, expect, it } from "vitest";
import {
  filterPaletteItems,
  itemMatchesScope,
  nextPaletteScope,
  PALETTE_COMMANDS,
  scorePaletteItem
} from "./command-palette";

describe("command palette matching", () => {
  it("finds commands by chinese or english keywords", () => {
    const git = PALETTE_COMMANDS.find((item) => item.id === "cmd:open-git");
    const terminal = PALETTE_COMMANDS.find((item) => item.id === "cmd:open-terminal");
    expect(git && scorePaletteItem(git, "git")).toBeGreaterThan(0);
    expect(terminal && scorePaletteItem(terminal, "终端")).toBeGreaterThan(0);
    expect(
      filterPaletteItems(PALETTE_COMMANDS, "新建").some((item) => item.id === "cmd:new-session")
    ).toBe(true);
    expect(
      filterPaletteItems(PALETTE_COMMANDS, "审批").some((item) => item.id === "cmd:open-approvals")
    ).toBe(true);
    expect(
      filterPaletteItems(PALETTE_COMMANDS, "转到行").some((item) => item.id === "cmd:goto-line")
    ).toBe(true);
    expect(
      filterPaletteItems(PALETTE_COMMANDS, "强化").some((item) => item.id === "cmd:enhance-prompt")
    ).toBe(true);
  });

  it("ranks exact title matches first", () => {
    const ranked = filterPaletteItems(PALETTE_COMMANDS, "打开 Git");
    expect(ranked[0]?.id).toBe("cmd:open-git");
  });

  it("matches pinyin initials and command aliases", () => {
    expect(
      filterPaletteItems(PALETTE_COMMANDS, "xjdh").some((item) => item.id === "cmd:new-session")
    ).toBe(true);
    expect(
      filterPaletteItems(PALETTE_COMMANDS, "zd").some((item) => item.id === "cmd:open-terminal")
    ).toBe(true);
    expect(
      filterPaletteItems(PALETTE_COMMANDS, "ot").some((item) => item.id === "cmd:open-terminal")
    ).toBe(true);
  });
});

describe("palette scopes", () => {
  it("cycles tabs like JetBrains search everywhere", () => {
    expect(nextPaletteScope("all", 1)).toBe("command");
    expect(nextPaletteScope("git", 1)).toBe("all");
    expect(nextPaletteScope("all", -1)).toBe("git");
  });

  it("filters items by selected tab", () => {
    const git = PALETTE_COMMANDS.find((item) => item.id === "cmd:open-git");
    expect(git && itemMatchesScope(git, "all")).toBe(true);
    expect(git && itemMatchesScope(git, "command")).toBe(true);
    expect(git && itemMatchesScope(git, "file")).toBe(false);
  });
});
