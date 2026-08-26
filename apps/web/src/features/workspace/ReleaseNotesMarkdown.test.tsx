import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReleaseNotesMarkdown } from "./ReleaseNotesMarkdown";

const sample = [
  "## What's Changed",
  "",
  "> Keep notes readable",
  "",
  "- feat: add updates",
  "- see [notes](https://example.com)",
  "",
  "Run `pnpm test` after install.",
  "",
  "| Package | Channel |",
  "| --- | --- |",
  "| codex-omni | npm |"
].join("\n");

describe("ReleaseNotesMarkdown", () => {
  it("renders GitHub-style headings, lists, links, quotes and tables", () => {
    const html = renderToStaticMarkup(<ReleaseNotesMarkdown text={sample} />);

    expect(html).toContain("<h2>");
    expect(html).toContain("What&#x27;s Changed");
    expect(html).toContain("<li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<code>");
    expect(html).toContain("<table>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("returns null for empty or whitespace-only notes", () => {
    expect(renderToStaticMarkup(<ReleaseNotesMarkdown text="" />)).toBe("");
    expect(renderToStaticMarkup(<ReleaseNotesMarkdown text={"  \n\t"} />)).toBe("");
  });

  it("does not render javascript URLs", () => {
    const html = renderToStaticMarkup(
      <ReleaseNotesMarkdown text={"[click](javascript:alert(1))"} />
    );
    expect(html).toContain("click");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
  });
});
