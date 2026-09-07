import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexRunInput } from "./codex-input.js";

describe("codex run input", () => {
  it("keeps plain text when there are no images", () => {
    expect(buildCodexRunInput("hello", [], "/tmp/project")).toBe("hello");
    expect(
      buildCodexRunInput(
        "hello",
        [{ name: "notes.md", path: ".codex-uploads/notes.md", kind: "text" }],
        "/tmp/project"
      )
    ).toBe("hello");
  });

  it("appends local_image items with absolute paths", () => {
    expect(
      buildCodexRunInput(
        "see this",
        [{ name: "shot.png", path: ".codex-uploads/shot.png", kind: "image" }],
        "/tmp/project"
      )
    ).toEqual([
      { type: "text", text: "see this" },
      { type: "local_image", path: path.resolve("/tmp/project", ".codex-uploads/shot.png") }
    ]);
  });
});
