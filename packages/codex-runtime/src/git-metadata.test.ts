import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { gitMetadataWritableRoots } from "./git-metadata.js";

const exec = promisify(execFile);
let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function git(cwd: string, ...args: string[]) {
  return exec("git", args, { cwd });
}

describe("git metadata writable roots", () => {
  it("returns the repository metadata directory", async () => {
    const root = await tempDir("codex-omni-git-");
    await git(root, "init", "-q");

    expect(gitMetadataWritableRoots(root)).toEqual([path.join(root, ".git")]);
  });

  it("returns both linked-worktree and common metadata directories", async () => {
    const root = await tempDir("codex-omni-git-");
    const worktree = await tempDir("codex-omni-worktree-");
    await git(root, "init", "-q");
    await git(root, "config", "user.name", "Codex Omni Test");
    await git(root, "config", "user.email", "test@example.com");
    await writeFile(path.join(root, "README.md"), "fixture\n");
    await git(root, "add", "README.md");
    await git(root, "commit", "-qm", "fixture");
    await git(root, "worktree", "add", "-qb", "linked", worktree);

    const roots = gitMetadataWritableRoots(worktree);
    expect(roots).toContain(path.join(root, ".git"));
    expect(roots).toContain(path.join(root, ".git", "worktrees", path.basename(worktree)));
  });

  it("returns no roots outside a repository", async () => {
    const root = await tempDir("codex-omni-no-git-");
    expect(gitMetadataWritableRoots(root)).toEqual([]);
  });
});
