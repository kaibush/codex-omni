import { describe, expect, it } from "vitest";
import { blameLabel, blameMatchesDocument, gitTextLineCount } from "./git-blame";

describe("git blame helpers", () => {
  it("counts lines the same way git blame does", () => {
    expect(gitTextLineCount("")).toBe(0);
    expect(gitTextLineCount("one\ntwo\nthree\n")).toBe(3);
    expect(gitTextLineCount("one\ntwo\nthree")).toBe(3);
  });

  it("formats committed and uncommitted annotations", () => {
    const now = Date.parse("2026-09-22T00:00:00Z");
    expect(
      blameLabel(
        {
          hash: "abc",
          shortHash: "abc",
          author: "Ada Lovelace",
          time: Date.parse("2026-09-01T00:00:00Z") / 1000,
          summary: "初始化编辑器",
          committed: true
        },
        now
      )
    ).toContain("Ada Lovelace");
    expect(
      blameLabel(
        { hash: "", shortHash: "", author: "", time: 0, summary: "", committed: false },
        now
      )
    ).toBe("未提交");
  });

  it("treats a trailing newline as aligned with blame", () => {
    const lines = [
      { hash: "a", shortHash: "a", author: "Dev", time: 1, summary: "init", committed: true },
      { hash: "a", shortHash: "a", author: "Dev", time: 1, summary: "init", committed: true },
      { hash: "a", shortHash: "a", author: "Dev", time: 1, summary: "init", committed: true }
    ];
    expect(blameMatchesDocument("one\ntwo\nthree\n", lines)).toBe(true);
    expect(blameMatchesDocument("one\ntwo\nthree\nfour\n", lines)).toBe(false);
  });
});
