import { describe, expect, it } from "vitest";
import {
  ancestorPaths,
  compactSelectedPaths,
  flattenVisibleFileEntries,
  joinProjectPath,
  parentProjectPath,
  parseFileLocation,
  previewKindFor,
  resolveOpenableFilePath,
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

  it("drops nested paths when a parent folder is already selected", () => {
    expect(compactSelectedPaths(["src/a.ts", "src", "src/lib/b.ts", "README.md"])).toEqual([
      "README.md",
      "src"
    ]);
  });

  it("flattens expanded tree rows in display order", () => {
    const directories = {
      "": [
        { name: "src", path: "src", type: "directory" as const },
        { name: "README.md", path: "README.md", type: "file" as const }
      ],
      src: [
        { name: "lib", path: "src/lib", type: "directory" as const },
        { name: "index.ts", path: "src/index.ts", type: "file" as const }
      ],
      "src/lib": [{ name: "util.ts", path: "src/lib/util.ts", type: "file" as const }]
    };
    expect(
      flattenVisibleFileEntries(directories, {
        expanded: ["", "src"],
        query: "",
        showHidden: false,
        sort: "name"
      }).map((entry) => entry.path)
    ).toEqual(["src", "src/lib", "src/index.ts", "README.md"]);
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
    expect(toProjectRelativePath("`src/app.ts`", "/repo/app")).toBe("src/app.ts");
    expect(toProjectRelativePath('"docs/shot.png"', "/repo/app")).toBe("docs/shot.png");
    expect(toProjectRelativePath("file:///repo/app/src/app.ts", "/repo/app")).toBe("src/app.ts");
    expect(toProjectRelativePath("/apps/web/src/foo.ts", "/repo/app")).toBe("apps/web/src/foo.ts");
    expect(toProjectRelativePath("/repo/app/src/app.ts", "/repo/app")).toBe("src/app.ts");
    expect(toProjectRelativePath("b/src/app.ts", "/repo/app")).toBe("src/app.ts");
    expect(toProjectRelativePath("src/app.ts:12:5", "/repo/app")).toBe("src/app.ts");
    expect(toProjectRelativePath("src/app.ts#L18", "/repo/app")).toBe("src/app.ts");
    expect(toProjectRelativePath("/workspace/app/.codex-uploads/foo.png", "/repo/app")).toBe(
      ".codex-uploads/foo.png"
    );
    expect(toProjectRelativePath("/workspace/app/src/app.ts", "/repo/app")).toBe("src/app.ts");
    expect(toProjectRelativePath("/workspace/app/src/app.ts", "/repo/app", "/workspace/app")).toBe(
      "src/app.ts"
    );
    expect(toProjectRelativePath("/workspace/other/src/app.ts", "/repo/app")).toBeNull();
    expect(toProjectRelativePath("/opt/app/secret.ts", "/repo/app")).toBeNull();
    expect(toProjectRelativePath("/data/app/secret.ts", "/repo/app")).toBeNull();
  });

  it("parses file locations and keeps outside files openable as absolute paths", () => {
    expect(parseFileLocation("src/app.ts:12:5")).toEqual({
      path: "src/app.ts",
      line: 12,
      column: 5
    });
    expect(parseFileLocation("src/app.ts#L18C3")).toEqual({
      path: "src/app.ts",
      line: 18,
      column: 3
    });
    expect(resolveOpenableFilePath("/tmp/gamepad.png", "/repo/app")).toEqual({
      path: "/tmp/gamepad.png",
      line: null,
      column: null,
      external: true
    });
    expect(resolveOpenableFilePath("/repo/app/src/app.ts:18", "/repo/app")).toEqual({
      path: "src/app.ts",
      line: 18,
      column: null,
      external: false
    });
    expect(resolveOpenableFilePath("/data/app/secret.ts", "/repo/app")).toEqual({
      path: "/data/app/secret.ts",
      line: null,
      column: null,
      external: true
    });
    expect(resolveOpenableFilePath("README.md", "/repo/app")).toEqual({
      path: "README.md",
      line: null,
      column: null,
      external: false
    });
    expect(resolveOpenableFilePath("")).toBeNull();
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
