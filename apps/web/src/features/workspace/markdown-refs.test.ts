import { describe, expect, it } from "vitest";
import { linkFileRefs, parseCodexFileHref, quoteMarkdown, snippetFileName } from "./markdown-refs";

describe("markdown file refs", () => {
  it("turns path:line mentions into custom links", () => {
    const linked = linkFileRefs("see @src/app.ts:12 and README.md:3");
    expect(linked).toContain("[src/app.ts:12](codex-file:src%2Fapp.ts?line=12)");
    expect(linked).toContain("[README.md:3](codex-file:README.md?line=3)");
    expect(parseCodexFileHref("codex-file:src%2Fapp.ts?line=12")).toEqual({
      path: "src/app.ts",
      line: 12
    });
  });

  it("quotes text for the composer", () => {
    expect(quoteMarkdown("hello\nworld")).toBe("> hello\n> world");
  });

  it("picks a snippet filename from the fence language", () => {
    expect(snippetFileName("ts")).toBe("snippet.ts");
    expect(snippetFileName("代码")).toBe("snippet.txt");
  });
});
