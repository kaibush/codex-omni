import { describe, expect, it } from "vitest";
import { buildCommitSuggestion, buildReleaseNotes, parseNameStatus } from "./git-suggest.js";

describe("git commit suggestions", () => {
  it("parses name-status lines", () => {
    expect(parseNameStatus("M\tsrc/a.ts\nA\tdocs/readme.md\n")).toEqual([
      { status: "M", path: "src/a.ts" },
      { status: "A", path: "docs/readme.md" }
    ]);
  });

  it("builds an editable conventional commit from staged files", () => {
    const message = buildCommitSuggestion({
      nameStatus: "A\tsrc/new.ts\nM\tsrc/a.ts",
      kind: "commit"
    });
    expect(message).toContain("feat:");
    expect(message).toContain("src/new.ts");
    expect(message).toContain("src/a.ts");
  });

  it("uses docs type for markdown-only changes", () => {
    const message = buildCommitSuggestion({
      nameStatus: "M\tdocs/guide.md",
      kind: "commit"
    });
    expect(message.startsWith("docs:")).toBe(true);
  });

  it("includes diff stat in the longer summary", () => {
    const message = buildCommitSuggestion({
      nameStatus: "M\tsrc/a.ts",
      stat: " src/a.ts | 3 +++\n 1 file changed",
      kind: "summary"
    });
    expect(message).toContain("1 file changed");
  });

  it("builds release notes from recent commits", () => {
    const notes = buildReleaseNotes([
      { hash: "abc", shortHash: "abc1234", author: "Dev", date: "2026-08-22", subject: "init" }
    ]);
    expect(notes).toContain("## 发布说明");
    expect(notes).toContain("abc1234 init");
  });
});
