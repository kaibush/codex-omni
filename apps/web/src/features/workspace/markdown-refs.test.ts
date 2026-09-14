import { describe, expect, it } from "vitest";
import {
  linkFileRefs,
  looksLikeProjectFilePath,
  parseCodexFileHref,
  parseProjectFileHref,
  quoteMarkdown,
  sanitizeFileRef,
  snippetFileName
} from "./markdown-refs";

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

  it("turns bare and backtick file paths into custom links", () => {
    const linked = linkFileRefs("see src/app.ts and `apps/web/src/foo.ts`");
    expect(linked).toContain("[src/app.ts](codex-file:src%2Fapp.ts)");
    expect(linked).toContain("[apps/web/src/foo.ts](codex-file:apps%2Fweb%2Fsrc%2Ffoo.ts)");
    expect(linked).not.toContain("`apps/web/src/foo.ts`");
    expect(linkFileRefs("open @src/app.ts")).toContain("[src/app.ts](codex-file:src%2Fapp.ts)");
  });

  it("does not treat https urls as file refs", () => {
    const linked = linkFileRefs("see https://example.com/foo.ts");
    expect(linked).toBe("see https://example.com/foo.ts");
    expect(parseProjectFileHref("https://example.com/foo.ts")).toBeNull();
    expect(looksLikeProjectFilePath("https://example.com/foo.ts")).toBe(false);
    expect(looksLikeProjectFilePath("example.com/foo.ts")).toBe(false);
  });

  it("does not rewrite fenced code or existing markdown links", () => {
    const fenced = linkFileRefs("```ts\nsrc/app.ts\n```");
    expect(fenced).toBe("```ts\nsrc/app.ts\n```");
    const existing = linkFileRefs("[docs](https://example.com/foo.ts)");
    expect(existing).toBe("[docs](https://example.com/foo.ts)");
  });

  it("parses markdown and file hrefs as in-project files", () => {
    expect(parseProjectFileHref("apps/web/src/foo.ts")).toEqual({
      path: "apps/web/src/foo.ts",
      line: null
    });
    expect(parseProjectFileHref("apps/web/src/foo.ts:18")).toEqual({
      path: "apps/web/src/foo.ts",
      line: 18
    });
    expect(parseProjectFileHref("codex-file:src%2Fapp.ts?line=12")).toEqual({
      path: "src/app.ts",
      line: 12
    });
    expect(parseProjectFileHref("mailto:user@example.com")).toBeNull();
    expect(parseProjectFileHref("#section")).toBeNull();
  });

  it("sanitizes wrapped file refs", () => {
    expect(sanitizeFileRef("`apps/web/src/foo.ts`")).toBe("apps/web/src/foo.ts");
    expect(sanitizeFileRef('"src/app.ts"')).toBe("src/app.ts");
    expect(sanitizeFileRef("file:///repo/app/src/app.ts")).toBe("/repo/app/src/app.ts");
    expect(sanitizeFileRef("src/app.ts),")).toBe("src/app.ts");
  });

  it("quotes text for the composer", () => {
    expect(quoteMarkdown("hello\nworld")).toBe("> hello\n> world");
  });

  it("picks a snippet filename from the fence language", () => {
    expect(snippetFileName("ts")).toBe("snippet.ts");
    expect(snippetFileName("代码")).toBe("snippet.txt");
  });
});
