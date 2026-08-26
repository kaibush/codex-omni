import { describe, expect, it } from "vitest";
import {
  DIFF_VIEW_HUNK_HEADER_RE,
  commitDiffLabel,
  commitDiffPath,
  diffViewHunks,
  firstOpenLine,
  hasTextHunks,
  hunkCount,
  parseDiffView,
  preferredDiffMode
} from "./git-diff";

const sample = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +2,4 @@",
  " one",
  "-two",
  "+added",
  " three"
].join("\n");

function hunkHeaders(diff: string, path = "file") {
  return (diffViewHunks(diff, path)[0] ?? "")
    .split("\n")
    .filter((line) => line.startsWith("@@"));
}

describe("git diff view", () => {
  it("tracks hunk indexes and old/new line numbers", () => {
    const rows = parseDiffView(sample);
    expect(hunkCount(sample)).toBe(1);
    const added = rows.find((row) => row.kind === "add");
    const deleted = rows.find((row) => row.kind === "del");
    expect(added?.newLine).toBe(3);
    expect(added?.hunkIndex).toBe(0);
    expect(deleted?.oldLine).toBe(2);
    expect(firstOpenLine(sample)).toBe(3);
    expect(hasTextHunks(sample)).toBe(true);
    expect(diffViewHunks(sample, "src/a.ts")[0]).toContain("@@ -1,3 +2,3 @@");
    expect(diffViewHunks(sample, "src/a.ts")[0]).toContain("+added");
  });

  it("treats empty and binary patches as having no text hunks", () => {
    expect(hasTextHunks("")).toBe(false);
    expect(hasTextHunks("Binary files a/x.bin and b/x.bin differ")).toBe(false);
    expect(diffViewHunks("暂无文本差异")).toEqual([]);
    expect(diffViewHunks("--- a/lock.yaml\n+++ b/lock.yaml\n@@ 文件过大，无法生成完整 Diff @@")).toEqual(
      []
    );
  });

  it("normalizes apply_patch and combined hunk headers for DiffView", () => {
    const patch = diffViewHunks("@@\n-old\n+new\n", "src/a.ts")[0] ?? "";
    expect(patch).toContain("--- a/src/a.ts");
    expect(hunkHeaders("@@\n-old\n+new\n", "src/a.ts")[0]).toMatch(DIFF_VIEW_HUNK_HEADER_RE);
    expect(
      hunkHeaders("@@@ -1,3 -1,3 +1,4 @@@\n context\n-old\n+new\n", "merge.ts")[0]
    ).toMatch(DIFF_VIEW_HUNK_HEADER_RE);
  });

  it("uses the destination path for renamed commit files", () => {
    expect(commitDiffPath("src/old.ts\tsrc/new.ts")).toBe("src/new.ts");
    expect(
      commitDiffLabel({ status: "R100", path: "src/new.ts", previousPath: "src/old.ts" })
    ).toBe("src/old.ts → src/new.ts");
  });

  it("defaults to unified diffs on narrow screens", () => {
    expect(preferredDiffMode(375)).toBe("unified");
    expect(preferredDiffMode(768)).toBe("split");
  });

});
