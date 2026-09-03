import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
import {
  MAX_EDITABLE_FILE_BYTES,
  compactDeletePaths,
  copyProjectEntry,
  createProjectEntry,
  deleteProjectEntries,
  deleteProjectEntry,
  listProjectDirectory,
  readProjectBinaryFile,
  readProjectTextFile,
  renameProjectEntry,
  searchProjectFiles,
  statProjectFile,
  writeProjectBinaryFile,
  writeProjectTextFile
} from "./project-file.js";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(
    temps.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-omni-project-file-"));
  temps.push(root);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n");
  return root;
}

describe("project text files", () => {
  it("reads, version-checks and saves UTF-8 text", async () => {
    const root = await fixture();
    const initial = await readProjectTextFile(root, "src/index.ts");
    expect(initial).toMatchObject({
      path: "src/index.ts",
      content: "export const value = 1;\n"
    });

    const saved = await writeProjectTextFile({
      rootPath: root,
      relativePath: initial.path,
      content: "export const value = 2;\n",
      expectedRevision: initial.revision
    });
    expect(saved.revision).not.toBe(initial.revision);
    expect(await readFile(path.join(root, "src", "index.ts"), "utf8")).toBe(
      "export const value = 2;\n"
    );
  });

  it("does not overwrite a file that changed after it was opened", async () => {
    const root = await fixture();
    const initial = await readProjectTextFile(root, "src/index.ts");
    await writeFile(path.join(root, "src", "index.ts"), "external change\n");

    await expect(
      writeProjectTextFile({
        rootPath: root,
        relativePath: initial.path,
        content: "editor change\n",
        expectedRevision: initial.revision
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await readFile(path.join(root, "src", "index.ts"), "utf8")).toBe("external change\n");
  });

  it("serializes concurrent saves that use the same revision", async () => {
    const root = await fixture();
    const initial = await readProjectTextFile(root, "src/index.ts");
    const save = (content: string) =>
      writeProjectTextFile({
        rootPath: root,
        relativePath: initial.path,
        content,
        expectedRevision: initial.revision
      });

    const results = await Promise.allSettled([save("first\n"), save("second\n")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { statusCode: 409 } });
    expect(["first\n", "second\n"]).toContain(
      await readFile(path.join(root, "src", "index.ts"), "utf8")
    );
  });

  it("enforces the size limit before loading or saving file content", async () => {
    const root = await fixture();
    const initial = await readProjectTextFile(root, "src/index.ts");
    const oversized = Buffer.alloc(MAX_EDITABLE_FILE_BYTES + 1, 97);
    await writeFile(path.join(root, "large.txt"), oversized);

    await expect(readProjectTextFile(root, "large.txt")).rejects.toMatchObject({ statusCode: 413 });
    await expect(
      writeProjectTextFile({
        rootPath: root,
        relativePath: initial.path,
        content: oversized.toString("utf8"),
        expectedRevision: initial.revision
      })
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(await readFile(path.join(root, "src", "index.ts"), "utf8")).toBe(
      "export const value = 1;\n"
    );
  });

  it("rejects invalid UTF-8 and content that would become binary", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "invalid.txt"), Buffer.from([0xc3, 0x28]));
    await expect(readProjectTextFile(root, "invalid.txt")).rejects.toMatchObject({
      statusCode: 400
    });

    const initial = await readProjectTextFile(root, "src/index.ts");
    await expect(
      writeProjectTextFile({
        rootPath: root,
        relativePath: initial.path,
        content: "text\0binary",
        expectedRevision: initial.revision
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await readFile(path.join(root, "src", "index.ts"), "utf8")).toBe(
      "export const value = 1;\n"
    );
  });

  it("preserves a UTF-8 byte-order mark when editing", async () => {
    const root = await fixture();
    const filePath = path.join(root, "bom.txt");
    await writeFile(
      filePath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello")])
    );
    const initial = await readProjectTextFile(root, "bom.txt");
    expect(initial.content).toBe("\ufeffhello");

    await writeProjectTextFile({
      rootPath: root,
      relativePath: initial.path,
      content: `${initial.content}!`,
      expectedRevision: initial.revision
    });
    expect(await readFile(filePath)).toEqual(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello!")])
    );
  });

  it("rejects a replaced file when the editor revision is stale", async () => {
    const root = await fixture();
    const initial = await readProjectTextFile(root, "src/index.ts");
    const filePath = path.join(root, "src", "index.ts");
    await unlink(filePath);
    await writeFile(filePath, "replacement\n");

    await expect(
      writeProjectTextFile({
        rootPath: root,
        relativePath: initial.path,
        content: "editor change\n",
        expectedRevision: initial.revision
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await readFile(filePath, "utf8")).toBe("replacement\n");
  });

  it("rejects binary files and symlinks that leave the project", async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), "codex-omni-project-file-outside-"));
    temps.push(outside);
    await writeFile(path.join(root, "binary.dat"), Buffer.from([1, 0, 2]));
    await writeFile(path.join(outside, "outside.txt"), "outside\n");
    await symlink(outside, path.join(root, "outside"));

    await expect(readProjectTextFile(root, "binary.dat")).rejects.toMatchObject({
      statusCode: 400
    });
    await expect(readProjectTextFile(root, "outside/outside.txt")).rejects.toMatchObject({
      statusCode: 403
    });
  });
});

describe("project file workspace operations", () => {
  it("lists directories with metadata and creates, renames, copies and deletes entries", async () => {
    const root = await fixture();
    const listed = await listProjectDirectory(root, "src");
    expect(listed.path).toBe("src");
    expect(listed.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "index.ts", type: "file", hidden: false })
      ])
    );

    const file = await createProjectEntry({
      rootPath: root,
      relativePath: "src/util.ts",
      type: "file",
      content: "export const n = 1;\n"
    });
    expect(file).toMatchObject({ path: "src/util.ts", type: "file" });
    expect(await readFile(path.join(root, "src", "util.ts"), "utf8")).toBe("export const n = 1;\n");

    const directory = await createProjectEntry({
      rootPath: root,
      relativePath: "docs",
      type: "directory"
    });
    expect(directory).toMatchObject({ path: "docs", type: "directory" });

    const renamed = await renameProjectEntry({
      rootPath: root,
      from: "src/util.ts",
      to: "docs/util.ts"
    });
    expect(renamed.path).toBe("docs/util.ts");
    await expect(access(path.join(root, "src", "util.ts"))).rejects.toBeTruthy();

    const copied = await copyProjectEntry({
      rootPath: root,
      from: "docs",
      to: "docs-copy"
    });
    expect(copied.path).toBe("docs-copy");
    expect(await readFile(path.join(root, "docs-copy", "util.ts"), "utf8")).toBe(
      "export const n = 1;\n"
    );

    await deleteProjectEntry(root, "docs-copy");
    await expect(access(path.join(root, "docs-copy"))).rejects.toBeTruthy();
    await deleteProjectEntry(root, "docs/util.ts");
    expect((await listProjectDirectory(root, "docs")).entries).toEqual([]);
  });

  it("rejects path escape, existing targets and project root deletion", async () => {
    const root = await fixture();
    await expect(
      createProjectEntry({ rootPath: root, relativePath: "../outside.ts", type: "file" })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      createProjectEntry({ rootPath: root, relativePath: ".git/config", type: "file" })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      createProjectEntry({ rootPath: root, relativePath: "src/index.ts", type: "file" })
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(deleteProjectEntry(root, "")).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      renameProjectEntry({ rootPath: root, from: "src", to: "src/nested" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("deletes multiple files and skips nested paths under a selected folder", async () => {
    const root = await fixture();
    await createProjectEntry({ rootPath: root, relativePath: "docs", type: "directory" });
    await createProjectEntry({
      rootPath: root,
      relativePath: "docs/a.ts",
      type: "file",
      content: "a\n"
    });
    await createProjectEntry({
      rootPath: root,
      relativePath: "keep.ts",
      type: "file",
      content: "keep\n"
    });
    expect(compactDeletePaths(["docs/a.ts", "docs", "keep.ts"])).toEqual(["docs", "keep.ts"]);
    const result = await deleteProjectEntries(root, ["docs/a.ts", "docs", "keep.ts"]);
    expect(result).toMatchObject({ ok: true, deleted: ["docs", "keep.ts"] });
    await expect(access(path.join(root, "docs"))).rejects.toBeTruthy();
    await expect(access(path.join(root, "keep.ts"))).rejects.toBeTruthy();
    expect((await listProjectDirectory(root, "src")).entries.length).toBeGreaterThan(0);
  });

  it("searches file names and UTF-8 contents with scan limits", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "docs", "readme.md"), "# Hello search target\nsecond line\n");
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "search target hidden\n");

    const names = await searchProjectFiles({ rootPath: root, query: "readme" });
    expect(names.matches).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "docs/readme.md", kind: "name" })])
    );

    const contents = await searchProjectFiles({
      rootPath: root,
      query: "search target",
      content: true
    });
    expect(contents.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "docs/readme.md",
          kind: "content",
          line: 1
        })
      ])
    );
    expect(contents.matches.some((match) => match.path.includes("node_modules"))).toBe(false);
  });

  it("finds nested source files and skips gitignored directories", async () => {
    const root = await fixture();
    await mkdir(path.join(root, ".reference", "huge"), { recursive: true });
    await writeFile(
      path.join(root, ".reference", "huge", "ProjectFilesPanel.tsx"),
      "ignored copy\n"
    );
    await mkdir(path.join(root, "apps", "web", "src", "features", "workspace"), {
      recursive: true
    });
    await writeFile(
      path.join(root, "apps", "web", "src", "features", "workspace", "ProjectFilesPanel.tsx"),
      "export const panel = 1;\n"
    );
    await writeFile(path.join(root, ".gitignore"), ".reference\nnode_modules\n");
    await execFileAsync("git", ["init"], { cwd: root });

    const names = await searchProjectFiles({ rootPath: root, query: "ProjectFilesPanel.tsx" });
    expect(names.matches.map((match) => match.path)).toEqual([
      "apps/web/src/features/workspace/ProjectFilesPanel.tsx"
    ]);

    const contents = await searchProjectFiles({
      rootPath: root,
      query: "export const panel",
      content: true
    });
    expect(contents.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "apps/web/src/features/workspace/ProjectFilesPanel.tsx",
          kind: "content"
        })
      ])
    );
  });

  it("uploads, stats and downloads binary files", async () => {
    const root = await fixture();
    const buffer = Buffer.from([1, 2, 3, 4]);
    const uploaded = await writeProjectBinaryFile({
      rootPath: root,
      relativePath: "src/data.bin",
      buffer
    });
    expect(uploaded).toMatchObject({ path: "src/data.bin", type: "file", size: 4 });

    const downloaded = await readProjectBinaryFile(root, "src/data.bin");
    expect(downloaded.buffer).toEqual(buffer);
    expect(downloaded.name).toBe("data.bin");

    const meta = await statProjectFile(root, "src/index.ts");
    expect(meta).toMatchObject({ path: "src/index.ts", type: "file", text: true });
    expect(meta.revision).toBeTruthy();

    await expect(
      writeProjectBinaryFile({
        rootPath: root,
        relativePath: "src/data.bin",
        buffer: Buffer.from([9])
      })
    ).rejects.toMatchObject({ statusCode: 409 });

    const overwritten = await writeProjectBinaryFile({
      rootPath: root,
      relativePath: "src/data.bin",
      buffer: Buffer.from([9]),
      overwrite: true
    });
    expect(overwritten.size).toBe(1);
  });
});
