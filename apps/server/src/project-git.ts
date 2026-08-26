import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isPathInside } from "./filesystem.js";
import { buildCommitSuggestion, buildReleaseNotes } from "./git-suggest.js";

const execFileAsync = promisify(execFile);

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

export type GitFile = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflict: boolean;
};

export type GitHunk = {
  header: string;
  lines: string[];
};

export type GitBranch = {
  name: string;
  current: boolean;
  remote: boolean;
};

export type GitCommitSummary = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};

async function runGit(
  cwd: string,
  args: string[],
  options: { allowExitCodeOne?: boolean; timeout?: number } = {}
) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: options.timeout ?? 30_000
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (reason) {
    const error = reason as Error & { code?: number | string; stdout?: string; stderr?: string };
    if (options.allowExitCodeOne && error.code === 1) {
      return { stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
    }
    throw httpError(400, (error.stderr || error.stdout || error.message).trim());
  }
}

export async function isGitRepository(cwd: string) {
  try {
    const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

function assertGitPath(rootPath: string, relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === ".git")) {
    throw httpError(400, "路径无效");
  }
  const resolved = path.resolve(rootPath, normalized);
  if (resolved !== rootPath && !isPathInside(resolved, rootPath)) {
    throw httpError(403, "路径不在项目目录内");
  }
  return normalized;
}

const isConflict = (indexStatus: string, worktreeStatus: string) =>
  ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${indexStatus}${worktreeStatus}`);

export async function gitStatus(rootPath: string) {
  if (!(await isGitRepository(rootPath)))
    return { isRepository: false as const, files: [] as GitFile[] };

  const [{ stdout: statusOutput }, branchResult] = await Promise.all([
    runGit(rootPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    runGit(rootPath, ["branch", "--show-current"])
  ]);
  const records = statusOutput.split("\0").filter(Boolean);
  const files: GitFile[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const indexStatus = record[0] ?? " ";
    const worktreeStatus = record[1] ?? " ";
    let filePath = record.slice(3);
    if (indexStatus === "R" || indexStatus === "C") {
      const renamedTo = records[index + 1];
      if (renamedTo) {
        filePath = renamedTo;
        index += 1;
      }
    }
    const conflict = isConflict(indexStatus, worktreeStatus);
    const untracked = indexStatus === "?";
    files.push({
      path: filePath,
      indexStatus,
      worktreeStatus,
      staged: indexStatus !== " " && indexStatus !== "?" && !conflict,
      unstaged: worktreeStatus !== " " || untracked,
      untracked,
      conflict
    });
  }

  let ahead = 0;
  let behind = 0;
  let hasUpstream = false;
  try {
    const { stdout } = await runGit(rootPath, [
      "rev-list",
      "--left-right",
      "--count",
      "@{upstream}...HEAD"
    ]);
    const [behindValue, aheadValue] = stdout.trim().split(/\s+/).map(Number);
    behind = behindValue || 0;
    ahead = aheadValue || 0;
    hasUpstream = true;
  } catch {
    hasUpstream = false;
  }

  return {
    isRepository: true as const,
    branch: branchResult.stdout.trim() || "HEAD",
    ahead,
    behind,
    hasUpstream,
    files
  };
}

function assertCommitHash(hash: string) {
  if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) throw httpError(400, "提交 hash 无效");
  return hash;
}

async function gitCommitPatch(rootPath: string, commit: string, filePath: string) {
  const parents = (await runGit(rootPath, ["rev-list", "--parents", "-n", "1", commit])).stdout
    .trim()
    .split(/\s+/)
    .slice(1);
  const parent = parents[0];
  const args = parent
    ? [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "--unified=3",
        "--find-renames",
        parent,
        commit,
        "--",
        filePath
      ]
    : [
        "show",
        "--pretty=format:",
        "--no-ext-diff",
        "--no-color",
        "--unified=3",
        "--find-renames",
        commit,
        "--",
        filePath
      ];
  return (await runGit(rootPath, args, { allowExitCodeOne: true })).stdout;
}

export async function gitDiff(
  rootPath: string,
  relativePath: string,
  staged: boolean,
  options: { commit?: string } = {}
) {
  const filePath = assertGitPath(rootPath, relativePath);
  if (options.commit) {
    const stdout = await gitCommitPatch(rootPath, assertCommitHash(options.commit), filePath);
    return { diff: stdout, hunks: parseDiffHunks(stdout) };
  }
  const args = ["diff", "--no-ext-diff", "--no-color", "--unified=3"];
  if (staged) args.push("--cached");
  args.push("--", filePath);
  let { stdout } = await runGit(rootPath, args, { allowExitCodeOne: true });
  if (!stdout && !staged) {
    stdout = (
      await runGit(
        rootPath,
        ["diff", "--no-index", "--no-color", "--unified=3", "/dev/null", filePath],
        { allowExitCodeOne: true }
      )
    ).stdout;
  }
  return { diff: stdout, hunks: parseDiffHunks(stdout) };
}

export function parseDiffHunks(diff: string): GitHunk[] {
  const hunks: GitHunk[] = [];
  let current: GitHunk | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@ ")) {
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (
      line.startsWith(" ") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line === "\\ No newline at end of file"
    ) {
      current.lines.push(line);
    }
  }
  return hunks;
}

export function firstNewLine(header: string) {
  const match = header.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
  return match ? Number(match[1]) : 1;
}

function patchForHunk(filePath: string, hunk: GitHunk) {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    hunk.header,
    ...hunk.lines,
    ""
  ].join("\n");
}

export async function applyGitHunk(input: {
  rootPath: string;
  relativePath: string;
  staged: boolean;
  hunkIndex: number;
  action: "stage" | "unstage" | "discard";
}) {
  const filePath = assertGitPath(input.rootPath, input.relativePath);
  const { hunks } = await gitDiff(input.rootPath, filePath, input.action === "unstage");
  const hunk = hunks[input.hunkIndex];
  if (!hunk) throw httpError(400, "找不到指定的 hunk");
  const patch = patchForHunk(filePath, hunk);
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-omni-git-hunk-"));
  const patchPath = path.join(directory, "hunk.patch");
  await writeFile(patchPath, patch);
  const args = ["apply", "--recount", "--whitespace=nowarn"];
  if (input.action === "stage") args.push("--cached");
  if (input.action === "unstage" || input.action === "discard") args.push("-R");
  if (input.action === "unstage") args.push("--cached");
  args.push(patchPath);
  await runGit(input.rootPath, args);
  return { ok: true as const };
}

export async function discardGitFiles(rootPath: string, paths: string[]) {
  const relativePaths = paths.map((item) => assertGitPath(rootPath, item));
  const status = await gitStatus(rootPath);
  const untracked = new Set(status.files.filter((file) => file.untracked).map((file) => file.path));
  const tracked = relativePaths.filter((item) => !untracked.has(item));
  const pendingDelete = relativePaths.filter((item) => untracked.has(item));
  if (tracked.length) {
    await runGit(rootPath, ["restore", "--worktree", "--source=HEAD", "--", ...tracked]);
  }
  if (pendingDelete.length) {
    await runGit(rootPath, ["clean", "-f", "--", ...pendingDelete]);
  }
  return { ok: true as const };
}

export async function listGitBranches(rootPath: string): Promise<GitBranch[]> {
  const { stdout } = await runGit(rootPath, [
    "branch",
    "--list",
    "--all",
    "--format=%(refname:short)%09%(HEAD)%09%(upstream:short)"
  ]);
  const seen = new Set<string>();
  const branches: GitBranch[] = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [name, head] = line.split("\t");
    if (!name || seen.has(name) || name.startsWith("origin/HEAD")) continue;
    seen.add(name);
    branches.push({
      name,
      current: head === "*",
      remote: name.startsWith("origin/")
    });
  }
  return branches;
}

export async function createGitBranch(rootPath: string, name: string, checkout: boolean) {
  const trimmed = name.trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed) || trimmed.includes("..")) {
    throw httpError(400, "分支名不合法");
  }
  await runGit(rootPath, checkout ? ["checkout", "-b", trimmed] : ["branch", trimmed]);
  return { ok: true as const, name: trimmed };
}

export async function checkoutGitBranch(rootPath: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw httpError(400, "分支名不能为空");
  await runGit(rootPath, ["checkout", trimmed]);
  return { ok: true as const, name: trimmed };
}

export async function deleteGitBranch(rootPath: string, name: string) {
  const trimmed = name.trim();
  const current = (await runGit(rootPath, ["branch", "--show-current"])).stdout.trim();
  if (trimmed === current) throw httpError(400, "不能删除当前分支");
  await runGit(rootPath, ["branch", "-d", trimmed]);
  return { ok: true as const };
}

export async function listGitLog(rootPath: string, limit = 40): Promise<GitCommitSummary[]> {
  let stdout = "";
  try {
    stdout = (
      await runGit(rootPath, [
        "log",
        `--max-count=${Math.min(Math.max(limit, 1), 100)}`,
        "--date=iso-strict",
        "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s"
      ])
    ).stdout;
  } catch {
    return [];
  }
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, author, date, subject] = line.split("\x1f");
      return {
        hash: hash ?? "",
        shortHash: shortHash ?? "",
        author: author ?? "",
        date: date ?? "",
        subject: subject ?? ""
      };
    });
}

export async function gitCommitDetail(rootPath: string, hash: string) {
  if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) throw httpError(400, "提交 hash 无效");
  const [meta, names, parents] = await Promise.all([
    runGit(rootPath, [
      "show",
      "-s",
      "--date=iso-strict",
      "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%b",
      hash
    ]),
    runGit(rootPath, ["show", "--pretty=format:", "--name-status", hash]),
    runGit(rootPath, ["rev-list", "--parents", "-n", "1", hash])
  ]);
  const [fullHash, shortHash, author, date, subject, body] = meta.stdout.split("\x1f");
  const parentHashes = (parents.stdout.trim().split(/\s+/) ?? []).slice(1);
  const files = names.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t").filter(Boolean);
      const status = parts[0] ?? "";
      if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) {
        return { status, previousPath: parts[1], path: parts[2] ?? "" };
      }
      return { status, path: parts.slice(1).join("\t") };
    });
  return {
    hash: fullHash ?? hash,
    shortHash: shortHash ?? hash.slice(0, 7),
    author: author ?? "",
    date: date ?? "",
    subject: subject ?? "",
    body: (body ?? "").trim(),
    parents: parentHashes,
    files
  };
}

export async function gitRemoteAction(rootPath: string, action: "fetch" | "pull" | "push") {
  const result = await runGit(rootPath, [action], { timeout: 120_000 });
  return { ok: true as const, output: (result.stdout || result.stderr).trim() };
}

export async function resolveGitConflict(
  rootPath: string,
  relativePath: string,
  strategy: "ours" | "theirs" | "mark"
) {
  const filePath = assertGitPath(rootPath, relativePath);
  if (strategy !== "mark") {
    await runGit(rootPath, [
      "checkout",
      strategy === "ours" ? "--ours" : "--theirs",
      "--",
      filePath
    ]);
  }
  await runGit(rootPath, ["add", "--", filePath]);
  return { ok: true as const };
}

const MAX_CHECKPOINT_PATCH_BYTES = 1_500_000;

export type GitCheckpointSnapshot = {
  isRepository: boolean;
  head: string | null;
  branch: string | null;
  status: string;
  patch: string;
  files: string[];
};

export async function captureGitCheckpoint(rootPath: string): Promise<GitCheckpointSnapshot> {
  if (!(await isGitRepository(rootPath))) {
    return { isRepository: false, head: null, branch: null, status: "", patch: "", files: [] };
  }
  const head = (await runGit(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
  const branch = (await runGit(rootPath, ["branch", "--show-current"])).stdout.trim();
  const status = (await runGit(rootPath, ["status", "--porcelain"])).stdout;
  let patch = (
    await runGit(rootPath, ["diff", "HEAD", "--no-ext-diff", "--no-color", "--binary"], {
      allowExitCodeOne: true
    })
  ).stdout;
  const untracked = (await runGit(rootPath, ["ls-files", "--others", "--exclude-standard"])).stdout
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 40);
  for (const file of untracked) {
    if (patch.length >= MAX_CHECKPOINT_PATCH_BYTES) break;
    const extra = (
      await runGit(
        rootPath,
        ["diff", "--no-index", "--no-color", "--unified=3", "/dev/null", file],
        { allowExitCodeOne: true }
      )
    ).stdout;
    if (extra.trim()) patch += extra.endsWith("\n") ? extra : `${extra}\n`;
  }
  if (Buffer.byteLength(patch) > MAX_CHECKPOINT_PATCH_BYTES) {
    patch = `${patch.slice(0, MAX_CHECKPOINT_PATCH_BYTES)}\n# truncated\n`;
  }
  const files = status
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  return { isRepository: true, head, branch: branch || "HEAD", status, patch, files };
}

export async function restoreGitCheckpoint(rootPath: string, checkpoint: GitCheckpointSnapshot) {
  if (!checkpoint.isRepository || !checkpoint.head) {
    throw httpError(400, "该检查点没有 Git 快照");
  }
  const head = (await runGit(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
  if (head !== checkpoint.head) {
    throw httpError(
      409,
      `HEAD 已从 ${checkpoint.head.slice(0, 7)} 变为 ${head.slice(0, 7)}，无法安全恢复工作区`
    );
  }
  let stashed = false;
  try {
    await runGit(rootPath, ["stash", "push", "-u", "-m", "codex-omni-checkpoint-safety"]);
    stashed = true;
  } catch {
    stashed = false;
  }
  try {
    if (checkpoint.patch.trim()) {
      const directory = await mkdtemp(path.join(os.tmpdir(), "codex-omni-checkpoint-"));
      const patchPath = path.join(directory, "checkpoint.patch");
      await writeFile(patchPath, checkpoint.patch);
      await runGit(rootPath, ["apply", "--whitespace=nowarn", patchPath]);
    }
  } catch (error) {
    if (stashed) {
      try {
        await runGit(rootPath, ["stash", "pop"]);
      } catch {
        // Keep the safety stash if pop fails.
      }
    }
    throw error;
  }
  return { ok: true as const, stashed };
}

export async function suggestGitMessage(rootPath: string, kind: "commit" | "summary" | "release") {
  if (!(await isGitRepository(rootPath))) {
    throw httpError(400, "当前目录不是 Git 仓库");
  }
  if (kind === "release") {
    const commits = await listGitLog(rootPath, 20);
    const message = buildReleaseNotes(commits);
    if (!message) throw httpError(400, "还没有提交记录");
    return { kind, message, source: "history" as const };
  }
  const nameStatus = (await runGit(rootPath, ["diff", "--cached", "--name-status"])).stdout;
  if (!nameStatus.trim()) throw httpError(400, "没有已暂存的变更");
  const stat = (await runGit(rootPath, ["diff", "--cached", "--stat"])).stdout;
  return {
    kind,
    message: buildCommitSuggestion({ nameStatus, stat, kind }),
    source: "staged" as const
  };
}
