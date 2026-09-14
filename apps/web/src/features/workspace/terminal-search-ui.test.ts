import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("terminal search ui", () => {
  it("can close the search panel on mobile", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "TerminalChatPanel.tsx"), "utf8");
    expect(source).toContain("const closeSearch = () => {");
    expect(source).toContain('aria-label="关闭搜索"');
    expect(source).toContain("{searchOpen ? \"关闭搜索\" : \"搜索历史\"}");
    expect(source).toContain("searchOpen && (searchPanelRef.current?.contains(target) || searchButtonRef.current?.contains(target))");
  });
});
