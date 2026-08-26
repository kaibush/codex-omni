import { describe, expect, it } from "vitest";
import { fileChangeEntries } from "./file-change";

describe("fileChangeEntries", () => {
  it("normalizes Codex file change payloads into unified diffs", () => {
    const entries = fileChangeEntries({
      changes: [
        {
          path: "src/App.tsx",
          kind: "add",
          diff: "@@ -0,0 +1,1 @@\n+export const n = 1;"
        }
      ]
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("src/App.tsx");
    expect(entries[0]?.diff).toContain("--- a/src/App.tsx");
    expect(entries[0]?.diff).toContain("+export const n = 1;");
  });

  it("falls back to a top-level diff string", () => {
    const entries = fileChangeEntries(
      { path: "README.md" },
      "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n"
    );
    expect(entries[0]?.path).toBe("README.md");
    expect(entries[0]?.diff).toContain("+new");
  });
});
