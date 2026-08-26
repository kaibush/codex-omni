import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStaticDir } from "./static-dir.js";

describe("resolveStaticDir", () => {
  it("uses CODEX_OMNI_STATIC when index.html exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "codex-omni-static-"));
    writeFileSync(path.join(dir, "index.html"), "<html></html>");
    expect(resolveStaticDir("/unused", { CODEX_OMNI_STATIC: dir })).toBe(dir);
  });

  it("returns empty when configured directory has no index", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "codex-omni-static-"));
    expect(resolveStaticDir("/unused", { CODEX_OMNI_STATIC: dir })).toBe("");
  });
});
