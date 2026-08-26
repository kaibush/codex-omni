import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyGitHunk,
  checkoutGitBranch,
  createGitBranch,
  deleteGitBranch,
  discardGitFiles,
  firstNewLine,
  gitDiff,
  gitStatus,
  listGitBranches,
  listGitLog,
  parseDiffHunks,
  captureGitCheckpoint,
  restoreGitCheckpoint
} from "./project-git.js";

const execFileAsync = promisify(execFile);
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(
    temps.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd, encoding: "utf8" });
}

async function repo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-omni-git-"));
  temps.push(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "dev@example.com"]);
  await git(root, ["config", "user.name", "Dev"]);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "a.ts"), "one\ntwo\nthree\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "init"]);
  return root;
}

describe("project git helpers", () => {
  it("parses hunks and reports the first new line", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " one",
      "+added",
      " two",
      " three"
    ].join("\n");
    const hunks = parseDiffHunks(diff);
    expect(hunks).toHaveLength(1);
    expect(firstNewLine(hunks[0]!.header)).toBe(1);
    expect(hunks[0]!.lines).toContain("+added");
  });

  it("stages a single hunk and lists branches and history", async () => {
    const root = await repo();
    await writeFile(path.join(root, "src", "a.ts"), "one\nadded\ntwo\nthree\n");
    const status = await gitStatus(root);
    expect(status.isRepository).toBe(true);
    expect(status.files[0]).toMatchObject({ path: "src/a.ts", unstaged: true, staged: false });

    const diff = await gitDiff(root, "src/a.ts", false);
    expect(diff.hunks.length).toBeGreaterThan(0);
    await applyGitHunk({
      rootPath: root,
      relativePath: "src/a.ts",
      staged: false,
      hunkIndex: 0,
      action: "stage"
    });
    const staged = await gitStatus(root);
    expect(staged.files[0]?.staged).toBe(true);

    const initialBranch = status.branch ?? "master";
    await createGitBranch(root, "feature/test", false);
    const branches = await listGitBranches(root);
    expect(branches.some((branch) => branch.name === "feature/test")).toBe(true);
    await checkoutGitBranch(root, "feature/test");
    await checkoutGitBranch(root, initialBranch);
    await deleteGitBranch(root, "feature/test");
    expect((await listGitBranches(root)).some((branch) => branch.name === "feature/test")).toBe(
      false
    );

    const log = await listGitLog(root);
    expect(log[0]?.subject).toBe("init");
  });

  it("returns a commit file patch instead of the working tree", async () => {
    const root = await repo();
    await writeFile(path.join(root, "src", "a.ts"), "one\nadded\ntwo\nthree\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "second"]);
    await writeFile(path.join(root, "src", "a.ts"), "working tree\n");
    const log = await listGitLog(root);
    const second = log[0];
    expect(second?.subject).toBe("second");
    const diff = await gitDiff(root, "src/a.ts", false, { commit: second!.hash });
    expect(diff.diff).toContain("+added");
    expect(diff.diff).not.toContain("working tree");
  });

  it("discards unstaged tracked changes", async () => {
    const root = await repo();
    await writeFile(path.join(root, "src", "a.ts"), "changed\n");
    await discardGitFiles(root, ["src/a.ts"]);
    const status = await gitStatus(root);
    expect(status.files).toEqual([]);
  });
});

describe("git checkpoints", () => {
  it("captures and restores a working tree checkpoint", async () => {
    const root = await repo();
    await writeFile(path.join(root, "src", "a.ts"), "one\nchanged\nthree\n");
    await writeFile(path.join(root, "src", "new.ts"), "created\n");
    const snapshot = await captureGitCheckpoint(root);
    expect(snapshot.isRepository).toBe(true);
    expect(snapshot.files.join(" ")).toContain("src/a.ts");
    expect(snapshot.patch).toContain("changed");
    await writeFile(path.join(root, "src", "a.ts"), "one\nlater\nthree\n");
    await restoreGitCheckpoint(root, snapshot);
    const restored = await readFile(path.join(root, "src", "a.ts"), "utf8");
    expect(restored).toContain("changed");
  });
});
