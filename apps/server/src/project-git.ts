import { execFile, spawn } from "node:child_process";
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

export type GitLogPage = {
  commits: GitCommitSummary[];
  hasMore: boolean;
};

export type GitBlameLine = {
  hash: string;
  shortHash: string;
  author: string;
  time: number;
  summary: string;
  committed: boolean;
};

export type GitBlameResult = {
  path: string;
  available: boolean;
  message: string;
  lines: GitBlameLine[];
};

const MAX_GIT_LOG_LIMIT = 200;
const MAX_GIT_LOG_SKIP = 200_000;
const MAX_BLAME_STDOUT_CHARS = 32_000_000;
const BLAME_TIMEOUT_MS = 20_000;

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

function parseGitLog(stdout: string): GitCommitSummary[] {
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

export async function listGitLogPage(
  rootPath: string,
  options: { limit?: number; skip?: number; all?: boolean } = {}
): Promise<GitLogPage> {
  const limit = Math.min(Math.max(options.limit ?? 40, 1), MAX_GIT_LOG_LIMIT);
  const skip = Math.min(Math.max(options.skip ?? 0, 0), MAX_GIT_LOG_SKIP);
  const args = [
    "log",
    `--max-count=${limit + 1}`,
    `--skip=${skip}`,
    "--date=iso-strict",
    "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s"
  ];
  if (options.all) args.splice(1, 0, "--all");
  try {
    const commits = parseGitLog((await runGit(rootPath, args)).stdout);
    return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
  } catch {
    return { commits: [], hasMore: false };
  }
}

export async function listGitLog(rootPath: string, limit = 40): Promise<GitCommitSummary[]> {
  return (await listGitLogPage(rootPath, { limit })).commits;
}

const BLAME_HEADER_RE = /^([0-9a-fA-F]{40}) (\d+) (\d+)(?: (\d+))?$/;

export function parseGitBlame(stdout: string): GitBlameLine[] {
  const rows = stdout.split("\n");
  const commits = new Map<string, { author: string; time: number; summary: string }>();
  const lines: GitBlameLine[] = [];
  let index = 0;
  while (index < rows.length) {
    const header = BLAME_HEADER_RE.exec(rows[index] ?? "");
    if (!header) {
      index += 1;
      continue;
    }
    const hash = (header[1] ?? "").toLowerCase();
    const finalLine = Number(header[3]);
    if (finalLine < 1 || finalLine > 100_000) {
      index += 1;
      continue;
    }
    index += 1;
    const known = commits.get(hash);
    let author = known?.author ?? "";
    let time = known?.time ?? 0;
    let summary = known?.summary ?? "";
    while (index < rows.length && !(rows[index] ?? "").startsWith("\t")) {
      const row = rows[index] ?? "";
      if (row.startsWith("author ")) author = row.slice("author ".length);
      else if (row.startsWith("author-time ")) time = Number(row.slice("author-time ".length)) || 0;
      else if (row.startsWith("summary ")) summary = row.slice("summary ".length);
      index += 1;
    }
    commits.set(hash, { author, time, summary });
    if ((rows[index] ?? "").startsWith("\t")) index += 1;
    const committed = !/^0+$/.test(hash);
    lines[finalLine - 1] = {
      hash: committed ? hash : "",
      shortHash: committed ? hash.slice(0, 7) : "",
      author: committed ? author : "",
      time,
      summary: committed ? summary : "",
      committed
    };
  }
  for (let line = 0; line < lines.length; line += 1) {
    if (!lines[line]) {
      lines[line] = { hash: "", shortHash: "", author: "", time: 0, summary: "", committed: false };
    }
  }
  return lines;
}

function blameUnavailable(relativePath: string, message: string): GitBlameResult {
  return { path: relativePath, available: false, message, lines: [] };
}

function runGitBlame(cwd: string, args: string[], input?: string) {
  return new Promise<{ stdout: string }>((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout });
    };
    timer = setTimeout(() => {
      child.kill();
      finish(httpError(400, "Git blame 超时"));
    }, BLAME_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_BLAME_STDOUT_CHARS) {
        child.kill();
        finish(httpError(400, "文件太大，无法显示 Blame"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish();
      else finish(httpError(400, stderr.trim() || "Git blame 失败"));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input ?? "");
  });
}

export async function gitBlame(
  rootPath: string,
  relativePath: string,
  content?: string
): Promise<GitBlameResult> {
  const filePath = assertGitPath(rootPath, relativePath);
  if (!(await isGitRepository(rootPath)))
    return blameUnavailable(filePath, "当前目录不是 Git 仓库");
  if (content !== undefined && Buffer.byteLength(content) > 2 * 1024 * 1024) {
    throw httpError(400, "文件超过 2 MB，无法计算 Blame");
  }
  const args = ["blame", "--line-porcelain"];
  if (content !== undefined) args.push("--contents", "-");
  args.push("--", filePath);
  try {
    const { stdout } = await runGitBlame(rootPath, args, content);
    return { path: filePath, available: true, message: "", lines: parseGitBlame(stdout) };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (/no such path|no such file or directory|bad revision/i.test(message)) {
      return blameUnavailable(filePath, "这个文件还没有 Git 记录");
    }
    if (/binary file/i.test(message)) return blameUnavailable(filePath, "二进制文件无法显示 Blame");
    throw reason instanceof Error ? reason : httpError(400, message);
  }
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
