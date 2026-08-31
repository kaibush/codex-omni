import { describe, expect, it } from "vitest";
import {
  ancestorPaths,
  joinProjectPath,
  parentProjectPath,
  previewKindFor,
  suggestedCopyPath,
  toProjectRelativePath,
  treeFilterPaths,
  unifiedDiff,
  visibleFileEntries
} from "./file-workspace";

describe("file workspace helpers", () => {
  it("joins, splits and suggests copy paths", () => {
    expect(joinProjectPath("src", "index.ts")).toBe("src/index.ts");
    expect(joinProjectPath("", "README.md")).toBe("README.md");
    expect(parentProjectPath("src/lib/api.ts")).toBe("src/lib");
    expect(suggestedCopyPath("src/api.ts")).toBe("src/api copy.ts");
    expect(suggestedCopyPath("Makefile")).toBe("Makefile copy");
  });

  it("filters hidden files and sorts by mtime", () => {
    const entries = [
      { name: "z.ts", path: "z.ts", type: "file" as const, mtimeMs: 1 },
      { name: ".env", path: ".env", type: "file" as const, hidden: true, mtimeMs: 3 },
      { name: "src", path: "src", type: "directory" as const, mtimeMs: 2 }
    ];
    expect(
      visibleFileEntries(entries, { query: "", showHidden: false, sort: "name" }).map(
        (entry) => entry.name
      )
    ).toEqual(["src", "z.ts"]);
    expect(
      visibleFileEntries(entries, { query: "env", showHidden: true, sort: "mtime" }).map(
        (entry) => entry.name
      )
    ).toEqual([".env"]);
  });

  it("keeps ancestor folders when filtering the file tree", () => {
    expect(ancestorPaths("apps/web/src/ProjectFilesPanel.tsx")).toEqual([
      "apps",
      "apps/web",
      "apps/web/src"
    ]);
    const keepPaths = treeFilterPaths(["apps/web/src/ProjectFilesPanel.tsx"]);
    expect([...keepPaths].sort()).toEqual(
      ["apps", "apps/web", "apps/web/src", "apps/web/src/ProjectFilesPanel.tsx"].sort()
    );
    const root = [
      { name: "apps", path: "apps", type: "directory" as const },
      { name: "docs", path: "docs", type: "directory" as const },
      { name: "README.md", path: "README.md", type: "file" as const }
    ];
    expect(
      visibleFileEntries(root, {
        query: "ProjectFilesPanel",
        showHidden: false,
        sort: "name",
        keepPaths
      }).map((entry) => entry.name)
    ).toEqual(["apps"]);
  });

  it("classifies media and markdown preview kinds", () => {
    expect(previewKindFor("shot.png")).toBe("image");
    expect(previewKindFor(".codex-uploads/foo.png")).toBe("image");
    expect(previewKindFor("/tmp/gamepad.png")).toBe("image");
    expect(previewKindFor("spec.pdf")).toBe("pdf");
    expect(previewKindFor("note.md")).toBe("markdown");
    expect(previewKindFor("app.ts", true)).toBe("text");
    expect(previewKindFor("blob.bin")).toBe("binary");
  });

  it("converts project-absolute paths and rejects files outside the project", () => {
    expect(toProjectRelativePath(".codex-uploads/foo.png", "/repo/app")).toBe(
      ".codex-uploads/foo.png"
    );
    expect(toProjectRelativePath("./docs/shot.png", "/repo/app")).toBe("docs/shot.png");
    expect(toProjectRelativePath("/repo/app/.codex-uploads/foo.png", "/repo/app")).toBe(
      ".codex-uploads/foo.png"
    );
    expect(toProjectRelativePath("/tmp/gamepad.png", "/repo/app")).toBeNull();
    expect(toProjectRelativePath("/repo/app-extra/x.png", "/repo/app")).toBeNull();
    expect(toProjectRelativePath("/repo/app", "/repo/app")).toBeNull();
    expect(toProjectRelativePath("/tmp/gamepad.png")).toBeNull();
  });

  it("builds a unified diff for inserted and deleted lines", () => {
    const diff = unifiedDiff("a\nb\nc\n", "a\nc\nd\n", "demo.txt");
    expect(diff).toContain("--- a/demo.txt");
    expect(diff).toContain("-b");
    expect(diff).toContain("+d");
    expect(diff).toContain(" a");
    expect(diff).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@/m);
  });

  it("returns no hunks for identical files, including large lockfiles", () => {
    const lockfile = Array.from({ length: 8000 }, (_, index) => `line-${index}`).join("\n");
    expect(unifiedDiff(lockfile, lockfile, "pnpm-lock.yaml")).toBe("");
  });

  it("emits a valid hunk header for a small change in a large file", () => {
    const previous = Array.from({ length: 3000 }, (_, index) => `line-${index}`);
    const next = previous.slice();
    next[1500] = "changed";
    const diff = unifiedDiff(previous.join("\n"), next.join("\n"), "pnpm-lock.yaml");
    expect(diff).toContain("-line-1500");
    expect(diff).toContain("+changed");
    expect(diff).not.toContain("@@ 文件过大");
    expect(diff).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@/m);
  });
});
