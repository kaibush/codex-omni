import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  breadcrumbs,
  browseDirectory,
  isPathInside,
  parentDirectory,
  parseAllowedRoots
} from "./filesystem.js";

const temps: string[] = [];
afterEach(async () => {
  temps.length = 0;
});

describe("filesystem helpers", () => {
  it("parses allowed roots and treats empty config as the system root", () => {
    expect(parseAllowedRoots("")).toEqual([path.parse(process.cwd()).root]);
    expect(parseAllowedRoots("/tmp,/var")).toEqual([path.resolve("/tmp"), path.resolve("/var")]);
  });

  it("detects path containment and parents", () => {
    expect(isPathInside("/root/project", "/root")).toBe(true);
    expect(isPathInside("/root", "/root")).toBe(true);
    expect(isPathInside("/var", "/root")).toBe(false);
    expect(parentDirectory("/root/project")).toBe("/root");
    expect(parentDirectory("/")).toBe(null);
  });

  it("builds breadcrumbs from the filesystem root", () => {
    expect(breadcrumbs("/root/project/github")).toEqual([
      { name: "/", path: "/" },
      { name: "root", path: "/root" },
      { name: "project", path: "/root/project" },
      { name: "github", path: "/root/project/github" }
    ]);
  });

  it("lists only directories and stays inside allowed roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-omni-fs-"));
    temps.push(root);
    await mkdir(path.join(root, "apps"));
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "README.md"), "hi");
    await symlink(path.join(root, "apps"), path.join(root, "apps-link"));

    const result = await browseDirectory(root, [root]);
    expect(result.path).toBe(await realpath(root));
    expect(result.entries.map((entry) => entry.name).sort()).toEqual(["apps", "apps-link", "docs"]);
    expect(result.entries.find((entry) => entry.name === "apps-link")?.symlink).toBe(true);
    expect(result.parent).toBe(null);

    await expect(browseDirectory("/tmp", [root])).rejects.toMatchObject({ statusCode: 403 });
  });
});
