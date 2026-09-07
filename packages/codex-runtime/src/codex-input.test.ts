import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCodexRunInput,
  resolveContainedAttachmentPath,
  sanitizeCodexAttachments
} from "./codex-input.js";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function projectWithUpload() {
  dir = await mkdtemp(path.join(os.tmpdir(), "codex-attach-"));
  const root = path.join(dir, "project");
  const upload = path.join(root, ".codex-uploads");
  await mkdir(upload, { recursive: true });
  const file = path.join(upload, "shot.png");
  await writeFile(file, "png");
  await writeFile(path.join(upload, "notes.md"), "notes");
  return { root, file, relative: ".codex-uploads/shot.png" };
}

describe("codex run input", () => {
  it("keeps plain text when there are no images", async () => {
    const { root } = await projectWithUpload();
    expect(buildCodexRunInput("hello", [], root)).toBe("hello");
    expect(
      buildCodexRunInput(
        "hello",
        [{ name: "notes.md", path: ".codex-uploads/notes.md", kind: "text" }],
        root
      )
    ).toBe("hello");
  });

  it("appends local_image items with contained absolute paths", async () => {
    const { root, file, relative } = await projectWithUpload();
    expect(
      buildCodexRunInput("see this", [{ name: "shot.png", path: relative, kind: "image" }], root)
    ).toEqual([
      { type: "text", text: "see this" },
      { type: "local_image", path: file }
    ]);
  });

  it("rejects absolute paths and symlink escapes outside the project", async () => {
    const { root } = await projectWithUpload();
    expect(() => resolveContainedAttachmentPath(root, "/etc/passwd")).toThrow("inside the project");
    expect(() => resolveContainedAttachmentPath(root, "../secret.png")).toThrow(
      "inside the project"
    );
    const outside = path.join(dir!, "outside.png");
    await writeFile(outside, "x");
    const link = path.join(root, ".codex-uploads", "escape.png");
    await symlink(outside, link);
    expect(() => resolveContainedAttachmentPath(root, ".codex-uploads/escape.png")).toThrow(
      "inside the project"
    );
    await rm(outside, { force: true });
  });

  it("accepts contained absolute paths", async () => {
    const { root, file } = await projectWithUpload();
    expect(
      sanitizeCodexAttachments(root, [{ name: "shot.png", path: file, kind: "image" }])
    ).toEqual([{ name: "shot.png", path: file, kind: "image" }]);
  });

  it.each(["", "  ", "shot\0.png"])("rejects invalid paths %j", async (filePath) => {
    const { root } = await projectWithUpload();
    expect(() => resolveContainedAttachmentPath(root, filePath)).toThrow("path is invalid");
  });

  it("rejects directories, missing files and non-image escapes", async () => {
    const { root } = await projectWithUpload();
    for (const filePath of [".codex-uploads", ".codex-uploads/missing.png"]) {
      expect(() => resolveContainedAttachmentPath(root, filePath)).toThrow("file not found");
    }
    expect(() =>
      buildCodexRunInput(
        "hello",
        [
          {
            name: "secret.txt",
            path: "../secret.txt",
            kind: "text"
          }
        ],
        root
      )
    ).toThrow("inside the project");
  });

  it("rejects sibling prefixes and symlinked parent directories", async () => {
    const { root } = await projectWithUpload();
    const sibling = `${root}-other`;
    await mkdir(sibling);
    await writeFile(path.join(sibling, "shot.png"), "outside");
    await symlink(sibling, path.join(root, "linked"), "dir");
    for (const filePath of [path.join(sibling, "shot.png"), "linked/shot.png"]) {
      expect(() => resolveContainedAttachmentPath(root, filePath)).toThrow("inside the project");
    }
  });

  it("supports symlinked project roots, in-project links and space-bearing filenames", async () => {
    const { root, file, relative } = await projectWithUpload();
    const alias = path.join(dir!, "alias");
    await symlink(root, alias, "dir");
    expect(resolveContainedAttachmentPath(alias, relative)).toBe(file);
    expect(resolveContainedAttachmentPath(alias, file)).toBe(file);
    await symlink(file, path.join(root, "linked.png"));
    expect(resolveContainedAttachmentPath(root, "linked.png")).toBe(file);
    const spaced = path.join(root, " image.png ");
    await writeFile(spaced, "image");
    expect(resolveContainedAttachmentPath(root, " image.png ")).toBe(spaced);
  });
});
