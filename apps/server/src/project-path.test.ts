import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { remapContainedPath, resolveProjectDirectory } from "./project-path.js";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("remapContainedPath", () => {
  it("rewrites the project root and nested working directories", () => {
    expect(remapContainedPath("/tmp/grok-iq", "/tmp/grok-iq", "/tmp/grok-iq-plus")).toBe(
      "/tmp/grok-iq-plus"
    );
    expect(remapContainedPath("/tmp/grok-iq/apps", "/tmp/grok-iq", "/tmp/grok-iq-plus")).toBe(
      "/tmp/grok-iq-plus/apps"
    );
    expect(remapContainedPath("/tmp/other", "/tmp/grok-iq", "/tmp/grok-iq-plus")).toBe(
      "/tmp/other"
    );
    expect(remapContainedPath("/tmp/grok-iq-old", "/tmp/grok-iq", "/tmp/grok-iq-plus")).toBe(
      "/tmp/grok-iq-old"
    );
  });
});

describe("resolveProjectDirectory", () => {
  it("resolves an existing directory and rejects files", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "omni-project-path-"));
    const nested = path.join(dir, "repo");
    await mkdir(nested);
    const resolved = await resolveProjectDirectory(nested);
    expect(resolved.displayPath).toBe(nested);
    expect(resolved.realPath).toBe(await realpath(nested));

    const file = path.join(dir, "readme.txt");
    await writeFile(file, "x");
    await expect(resolveProjectDirectory(file)).rejects.toMatchObject({
      statusCode: 400,
      message: "工程路径不是目录"
    });
    await expect(resolveProjectDirectory(path.join(dir, "missing"))).rejects.toMatchObject({
      statusCode: 400,
      message: "工程路径不存在或无法访问"
    });
  });
});
