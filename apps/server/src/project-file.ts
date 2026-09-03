import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { isPathInside } from "./filesystem.js";
import { isGitRepository } from "./project-git.js";

const execFileAsync = promisify(execFile);

export const MAX_EDITABLE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_SEARCH_RESULTS = 80;
export const MAX_SEARCH_SCAN = 20_000;
export const MAX_CONTENT_SEARCH_BYTES = 256 * 1024;

export type ProjectTextFile = {
  path: string;
  content: string;
  size: number;
  revision: string;
  writable: boolean;
};

export type ProjectFileMeta = {
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  mtimeMs: number;
  writable: boolean;
  revision: string | null;
  text: boolean;
};

export type ProjectDirectoryEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink";
  size: number;
  mtimeMs: number;
  hidden: boolean;
};

export type ProjectDirectoryListing = {
  path: string;
  entries: ProjectDirectoryEntry[];
};

export type ProjectSearchMatch = {
  path: string;
  type: "file" | "directory" | "symlink";
  kind: "name" | "content";
  line?: number;
  text?: string;
};

export type ProjectSearchResult = {
  query: string;
  truncated: boolean;
  scanned: number;
  matches: ProjectSearchMatch[];
};

export type ProjectBinaryFile = {
  path: string;
  name: string;
  size: number;
  contentType: string;
  buffer: Buffer;
};

type FileIdentity = {
  dev: bigint;
  ino: bigint;
  size: number;
};

const SEARCH_IGNORE = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "vendor",
  ".reference",
  "test-results",
  "playwright-report",
  ".vite",
  ".output",
  ".pnpm",
  "logs"
]);

const CONTENT_TYPES: Record<string, string> = {
  aac: "audio/aac",
  avif: "image/avif",
  bmp: "image/bmp",
  css: "text/css; charset=utf-8",
  flac: "audio/flac",
  gif: "image/gif",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  m4a: "audio/mp4",
  md: "text/markdown; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  xml: "application/xml; charset=utf-8",
  yaml: "text/yaml; charset=utf-8",
  yml: "text/yaml; charset=utf-8"
};

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

const revisionFor = (buffer: Buffer) => createHash("sha256").update(buffer).digest("base64url");
const fileWriteLocks = new Map<string, Promise<void>>();

const toPosix = (value: string) => value.split(path.sep).join("/");

async function isWritable(resolvedPath: string) {
  try {
    await access(resolvedPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function normalizeProjectRelativePath(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized.includes("\0")) throw httpError(400, "路径无效");
  if (!normalized) return "";
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === ".." || part === ".git")) {
    throw httpError(400, "路径无效");
  }
  return parts.join("/");
}

async function resolveProjectRoot(rootPath: string) {
  try {
    return await realpath(rootPath);
  } catch {
    throw httpError(404, "项目目录不存在或无法访问");
  }
}

function assertInsideProject(resolvedPath: string, canonicalRoot: string) {
  if (resolvedPath !== canonicalRoot && !isPathInside(resolvedPath, canonicalRoot)) {
    throw httpError(403, "文件路径不在项目目录内");
  }
}

async function resolveExistingFile(rootPath: string, relativePath: string) {
  const canonicalRoot = await resolveProjectRoot(rootPath);
  const normalized = normalizeProjectRelativePath(relativePath);
  if (!normalized) throw httpError(400, "路径不是文件");
  const requestedPath = path.resolve(canonicalRoot, normalized);
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(requestedPath);
  } catch {
    throw httpError(404, "文件不存在或无法访问");
  }
  assertInsideProject(resolvedPath, canonicalRoot);
  if (resolvedPath === canonicalRoot) throw httpError(400, "路径不是文件");
  const fileStat = await stat(resolvedPath, { bigint: true });
  if (!fileStat.isFile()) throw httpError(400, "路径不是文件");
  return {
    canonicalRoot,
    resolvedPath,
    identity: { dev: fileStat.dev, ino: fileStat.ino, size: Number(fileStat.size) }
  };
}

async function resolveEntryLocation(rootPath: string, relativePath: string) {
  const canonicalRoot = await resolveProjectRoot(rootPath);
  const normalized = normalizeProjectRelativePath(relativePath);
  if (!normalized) throw httpError(400, "不能操作项目根目录");
  const parentRelative = path.posix.dirname(normalized);
  const name = path.posix.basename(normalized);
  const parentAbs =
    parentRelative === "." ? canonicalRoot : path.resolve(canonicalRoot, parentRelative);
  let parentReal: string;
  try {
    parentReal = await realpath(parentAbs);
  } catch {
    throw httpError(404, "父目录不存在或无法访问");
  }
  assertInsideProject(parentReal, canonicalRoot);
  const info = await stat(parentReal);
  if (!info.isDirectory()) throw httpError(400, "父路径不是目录");
  const targetPath = path.join(parentReal, name);
  assertInsideProject(targetPath, canonicalRoot);
  return { canonicalRoot, normalized, name, parentReal, targetPath };
}

async function assertSameFile(resolvedPath: string, expected: FileIdentity) {
  const currentPath = await realpath(resolvedPath).catch(() => {
    throw httpError(409, "文件路径已发生变化，请重新加载后再编辑");
  });
  if (currentPath !== resolvedPath) {
    throw httpError(409, "文件路径已发生变化，请重新加载后再编辑");
  }
  const currentStat = await stat(resolvedPath, { bigint: true }).catch(() => {
    throw httpError(409, "文件路径已发生变化，请重新加载后再编辑");
  });
  if (
    !currentStat.isFile() ||
    currentStat.dev !== expected.dev ||
    currentStat.ino !== expected.ino
  ) {
    throw httpError(409, "文件路径已发生变化，请重新加载后再编辑");
  }
}

function decodeTextFile(buffer: Buffer) {
  if (buffer.includes(0)) throw httpError(400, "二进制文件暂不支持在线编辑");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw httpError(400, "文件不是有效的 UTF-8 文本，暂不支持在线编辑");
  }
}

function isProbablyText(buffer: Buffer) {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function contentTypeFor(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return (extension && CONTENT_TYPES[extension]) || "application/octet-stream";
}

function entryType(info: {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): ProjectDirectoryEntry["type"] {
  if (info.isSymbolicLink()) return "symlink";
  if (info.isDirectory()) return "directory";
  return "file";
}

async function withFileWriteLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = fileWriteLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => hold);
  fileWriteLocks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (fileWriteLocks.get(key) === current) fileWriteLocks.delete(key);
  }
}

export async function listProjectDirectory(
  rootPath: string,
  relativePath = ""
): Promise<ProjectDirectoryListing> {
  const canonicalRoot = await resolveProjectRoot(rootPath);
  const normalized = normalizeProjectRelativePath(relativePath);
  const requestedPath = normalized ? path.resolve(canonicalRoot, normalized) : canonicalRoot;
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(requestedPath);
  } catch {
    throw httpError(404, "目录不存在或无法访问");
  }
  assertInsideProject(resolvedPath, canonicalRoot);
  const directoryStat = await stat(resolvedPath);
  if (!directoryStat.isDirectory()) throw httpError(400, "路径不是目录");
  const dirents = await readdir(resolvedPath, { withFileTypes: true });
  const entries: ProjectDirectoryEntry[] = [];
  for (const dirent of dirents) {
    if (dirent.name === ".git") continue;
    const childPath = path.join(resolvedPath, dirent.name);
    let info;
    try {
      info = await lstat(childPath);
    } catch {
      continue;
    }
    entries.push({
      name: dirent.name,
      path: toPosix(path.relative(canonicalRoot, childPath)),
      type: entryType({
        isDirectory: () => dirent.isDirectory() || info.isDirectory(),
        isSymbolicLink: () => dirent.isSymbolicLink() || info.isSymbolicLink()
      }),
      size: Number(info.size),
      mtimeMs: Math.trunc(info.mtimeMs),
      hidden: dirent.name.startsWith(".")
    });
  }
  entries.sort((left, right) =>
    left.type === right.type
      ? left.name.localeCompare(right.name)
      : left.type === "directory"
        ? -1
        : right.type === "directory"
          ? 1
          : left.name.localeCompare(right.name)
  );
  return {
    path: toPosix(path.relative(canonicalRoot, resolvedPath)),
    entries
  };
}

export async function readProjectTextFile(
  rootPath: string,
  relativePath: string
): Promise<ProjectTextFile> {
  const { canonicalRoot, resolvedPath, identity } = await resolveExistingFile(
    rootPath,
    relativePath
  );
  if (identity.size > MAX_EDITABLE_FILE_BYTES) {
    throw httpError(413, "文件超过 2 MB，暂不支持在线编辑");
  }
  const buffer = await readFile(resolvedPath);
  if (buffer.byteLength > MAX_EDITABLE_FILE_BYTES) {
    throw httpError(413, "文件超过 2 MB，暂不支持在线编辑");
  }
  return {
    path: toPosix(path.relative(canonicalRoot, resolvedPath)),
    content: decodeTextFile(buffer),
    size: buffer.byteLength,
    revision: revisionFor(buffer),
    writable: await isWritable(resolvedPath)
  };
}

export async function statProjectFile(
  rootPath: string,
  relativePath: string
): Promise<ProjectFileMeta> {
  const location = await resolveEntryLocation(rootPath, relativePath);
  let info;
  try {
    info = await lstat(location.targetPath);
  } catch {
    throw httpError(404, "路径不存在或无法访问");
  }
  const type = entryType(info);
  let revision: string | null = null;
  let text = false;
  if (type === "file" && info.size <= MAX_EDITABLE_FILE_BYTES) {
    try {
      const buffer = await readFile(location.targetPath);
      if (buffer.byteLength <= MAX_EDITABLE_FILE_BYTES && isProbablyText(buffer)) {
        revision = revisionFor(buffer);
        text = true;
      }
    } catch {
      revision = null;
    }
  }
  if (!revision) {
    revision = `${Math.trunc(info.mtimeMs)}:${Number(info.size)}`;
  }
  return {
    path: location.normalized,
    type,
    size: Number(info.size),
    mtimeMs: Math.trunc(info.mtimeMs),
    writable: await isWritable(location.targetPath),
    revision,
    text
  };
}

export async function writeProjectTextFile(input: {
  rootPath: string;
  relativePath: string;
  content: string;
  expectedRevision: string;
}): Promise<ProjectTextFile> {
  const next = Buffer.from(input.content, "utf8");
  if (next.byteLength > MAX_EDITABLE_FILE_BYTES) {
    throw httpError(413, "文件超过 2 MB，暂不支持在线保存");
  }
  const normalizedContent = decodeTextFile(next);
  if (normalizedContent !== input.content) {
    throw httpError(400, "内容包含无法按 UTF-8 原样保存的字符");
  }

  const { canonicalRoot, resolvedPath, identity } = await resolveExistingFile(
    input.rootPath,
    input.relativePath
  );
  if (identity.size > MAX_EDITABLE_FILE_BYTES) {
    throw httpError(413, "文件超过 2 MB，暂不支持在线保存");
  }
  return withFileWriteLock(resolvedPath, async () => {
    await assertSameFile(resolvedPath, identity);
    const current = await readFile(resolvedPath);
    if (current.byteLength > MAX_EDITABLE_FILE_BYTES) {
      throw httpError(413, "文件超过 2 MB，暂不支持在线保存");
    }
    if (revisionFor(current) !== input.expectedRevision) {
      throw httpError(409, "文件已在磁盘上发生变化，请重新加载后再编辑");
    }
    try {
      await writeFile(resolvedPath, next);
    } catch (reason) {
      const code = (reason as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        throw httpError(403, "文件没有写权限");
      }
      throw reason;
    }
    return {
      path: toPosix(path.relative(canonicalRoot, resolvedPath)),
      content: normalizedContent,
      size: next.byteLength,
      revision: revisionFor(next),
      writable: await isWritable(resolvedPath)
    };
  });
}

export async function createProjectEntry(input: {
  rootPath: string;
  relativePath: string;
  type: "file" | "directory";
  content?: string;
}) {
  const location = await resolveEntryLocation(input.rootPath, input.relativePath);
  try {
    await access(location.targetPath);
    throw httpError(409, "目标路径已存在");
  } catch (reason) {
    if ((reason as { statusCode?: number }).statusCode === 409) throw reason;
  }
  try {
    if (input.type === "directory") {
      await mkdir(location.targetPath);
    } else {
      const content = input.content ?? "";
      const buffer = Buffer.from(content, "utf8");
      if (buffer.byteLength > MAX_EDITABLE_FILE_BYTES) {
        throw httpError(413, "文件超过 2 MB，暂不支持在线创建");
      }
      if (content) decodeTextFile(buffer);
      await writeFile(location.targetPath, buffer, { flag: "wx" });
    }
  } catch (reason) {
    const code = (reason as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw httpError(409, "目标路径已存在");
    if (code === "ENOENT") throw httpError(404, "父目录不存在或无法访问");
    if (code === "EACCES" || code === "EPERM") throw httpError(403, "没有写权限");
    if ((reason as { statusCode?: number }).statusCode) throw reason;
    throw reason;
  }
  return listEntry(location.canonicalRoot, location.targetPath, location.normalized);
}

export async function renameProjectEntry(input: { rootPath: string; from: string; to: string }) {
  const source = await resolveEntryLocation(input.rootPath, input.from);
  const destination = await resolveEntryLocation(input.rootPath, input.to);
  try {
    await lstat(source.targetPath);
  } catch {
    throw httpError(404, "源路径不存在或无法访问");
  }
  try {
    await access(destination.targetPath);
    throw httpError(409, "目标路径已存在");
  } catch (reason) {
    if ((reason as { statusCode?: number }).statusCode === 409) throw reason;
  }
  if (destination.targetPath === source.targetPath) {
    return listEntry(source.canonicalRoot, source.targetPath, source.normalized);
  }
  if (isPathInside(destination.targetPath, source.targetPath)) {
    throw httpError(400, "不能将目录移动到自身内部");
  }
  try {
    await rename(source.targetPath, destination.targetPath);
  } catch (reason) {
    const code = (reason as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") throw httpError(403, "没有写权限");
    throw reason;
  }
  return listEntry(destination.canonicalRoot, destination.targetPath, destination.normalized);
}

export async function copyProjectEntry(input: { rootPath: string; from: string; to: string }) {
  const source = await resolveEntryLocation(input.rootPath, input.from);
  const destination = await resolveEntryLocation(input.rootPath, input.to);
  try {
    await lstat(source.targetPath);
  } catch {
    throw httpError(404, "源路径不存在或无法访问");
  }
  try {
    await access(destination.targetPath);
    throw httpError(409, "目标路径已存在");
  } catch (reason) {
    if ((reason as { statusCode?: number }).statusCode === 409) throw reason;
  }
  if (destination.targetPath === source.targetPath) {
    throw httpError(400, "不能复制到相同路径");
  }
  if (isPathInside(destination.targetPath, source.targetPath)) {
    throw httpError(400, "不能将目录复制到自身内部");
  }
  try {
    await cp(source.targetPath, destination.targetPath, {
      recursive: true,
      errorOnExist: true,
      force: false
    });
  } catch (reason) {
    const code = (reason as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw httpError(409, "目标路径已存在");
    if (code === "EACCES" || code === "EPERM") throw httpError(403, "没有写权限");
    throw reason;
  }
  return listEntry(destination.canonicalRoot, destination.targetPath, destination.normalized);
}

export function compactDeletePaths(paths: string[]) {
  const normalized = [
    ...new Set(paths.map((item) => normalizeProjectRelativePath(item)).filter(Boolean))
  ].sort();
  const compact: string[] = [];
  for (const path of normalized) {
    if (compact.some((parent) => path.startsWith(`${parent}/`))) continue;
    compact.push(path);
  }
  return compact;
}

export async function deleteProjectEntries(rootPath: string, relativePaths: string[]) {
  if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
    throw httpError(400, "请选择要删除的文件或目录");
  }
  if (relativePaths.length > 200) throw httpError(400, "一次最多删除 200 项");
  const compact = compactDeletePaths(relativePaths);
  if (!compact.length) throw httpError(400, "请选择要删除的文件或目录");
  const deleted: string[] = [];
  const failed: Array<{ path: string; message: string }> = [];
  for (const path of compact) {
    try {
      await deleteProjectEntry(rootPath, path);
      deleted.push(path);
    } catch (reason) {
      failed.push({
        path,
        message: reason instanceof Error ? reason.message : String(reason)
      });
    }
  }
  if (!deleted.length) {
    throw httpError(400, failed[0]?.message ?? "删除失败");
  }
  return { ok: failed.length === 0, deleted, failed };
}

export async function deleteProjectEntry(rootPath: string, relativePath: string) {
  const location = await resolveEntryLocation(rootPath, relativePath);
  let info;
  try {
    info = await lstat(location.targetPath);
  } catch {
    throw httpError(404, "路径不存在或无法访问");
  }
  try {
    if (info.isDirectory() && !info.isSymbolicLink()) {
      await rm(location.targetPath, { recursive: true, force: false });
    } else {
      await rm(location.targetPath, { force: false });
    }
  } catch (reason) {
    const code = (reason as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") throw httpError(403, "没有写权限");
    throw reason;
  }
  return { ok: true as const, path: location.normalized };
}

export async function readProjectBinaryFile(
  rootPath: string,
  relativePath: string
): Promise<ProjectBinaryFile> {
  const { canonicalRoot, resolvedPath, identity } = await resolveExistingFile(
    rootPath,
    relativePath
  );
  if (identity.size > MAX_DOWNLOAD_BYTES) {
    throw httpError(413, "文件超过 50 MB，暂不支持下载");
  }
  const buffer = await readFile(resolvedPath);
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw httpError(413, "文件超过 50 MB，暂不支持下载");
  }
  const relative = toPosix(path.relative(canonicalRoot, resolvedPath));
  return {
    path: relative,
    name: path.posix.basename(relative),
    size: buffer.byteLength,
    contentType: contentTypeFor(path.posix.basename(relative)),
    buffer
  };
}

export async function writeProjectBinaryFile(input: {
  rootPath: string;
  relativePath: string;
  buffer: Buffer;
  overwrite?: boolean;
}) {
  if (input.buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw httpError(413, "文件超过 10 MB，暂不支持上传");
  }
  const location = await resolveEntryLocation(input.rootPath, input.relativePath);
  const exists = await access(location.targetPath)
    .then(() => true)
    .catch(() => false);
  if (exists && !input.overwrite) {
    throw httpError(409, "目标路径已存在");
  }
  if (exists) {
    const info = await lstat(location.targetPath);
    if (info.isDirectory()) throw httpError(400, "不能覆盖目录");
  }
  try {
    await writeFile(location.targetPath, input.buffer, { flag: input.overwrite ? "w" : "wx" });
  } catch (reason) {
    const code = (reason as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw httpError(409, "目标路径已存在");
    if (code === "EACCES" || code === "EPERM") throw httpError(403, "没有写权限");
    throw reason;
  }
  return listEntry(location.canonicalRoot, location.targetPath, location.normalized);
}

function nameMatchRank(filePath: string, needle: string) {
  const name = (filePath.split("/").pop() ?? filePath).toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  if (filePath.toLowerCase().includes(needle)) return 3;
  return 4;
}

function sortSearchMatches(matches: ProjectSearchMatch[], needle: string) {
  return [...matches].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "name" ? -1 : 1;
    const rank = nameMatchRank(left.path, needle) - nameMatchRank(right.path, needle);
    if (rank !== 0) return rank;
    return left.path.length - right.path.length || left.path.localeCompare(right.path);
  });
}

async function runGitOutput(cwd: string, args: string[]) {
  try {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    const result = await execFileAsync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 12 * 1024 * 1024,
      timeout: 15_000
    });
    return result.stdout;
  } catch (reason) {
    const error = reason as Error & { code?: number | string; stdout?: string };
    if (error.code === 1) return error.stdout ?? "";
    return null;
  }
}

async function searchGitProjectFiles(input: {
  rootPath: string;
  query: string;
  content?: boolean;
}): Promise<ProjectSearchResult | null> {
  if (!(await isGitRepository(input.rootPath))) return null;
  const listed = await runGitOutput(input.rootPath, [
    "ls-files",
    "-co",
    "--exclude-standard",
    "-z"
  ]);
  if (listed === null) return null;
  const needle = input.query.toLowerCase();
  const files = listed
    .split("\0")
    .filter(Boolean)
    .map((item) => item.replaceAll("\\", "/"));
  const matches: ProjectSearchMatch[] = [];
  const seen = new Set<string>();
  for (const relative of files) {
    const name = relative.split("/").pop() ?? relative;
    if (name.toLowerCase().includes(needle) || relative.toLowerCase().includes(needle)) {
      if (!seen.has(`name:${relative}`)) {
        seen.add(`name:${relative}`);
        matches.push({ path: relative, type: "file", kind: "name" });
      }
    }
    const parts = relative.split("/");
    let directory = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index] ?? "";
      directory = directory ? `${directory}/${part}` : part;
      if (!part.toLowerCase().includes(needle) || seen.has(`name:${directory}`)) continue;
      seen.add(`name:${directory}`);
      matches.push({ path: directory, type: "directory", kind: "name" });
    }
  }
  if (input.content) {
    const grepArgs = [
      "grep",
      "-n",
      "-I",
      "-i",
      "-F",
      "--untracked",
      "--max-count=5",
      "-e",
      input.query,
      "--",
      "."
    ];
    let grep = await runGitOutput(input.rootPath, grepArgs);
    if (grep === null) {
      grep = await runGitOutput(
        input.rootPath,
        grepArgs.filter((arg) => arg !== "--untracked")
      );
    }
    if (grep) {
      for (const line of grep.split("\n")) {
        if (!line) continue;
        const match = /^(.*?):(\d+):(.*)$/.exec(line);
        if (!match) continue;
        matches.push({
          path: (match[1] ?? "").replaceAll("\\", "/"),
          type: "file",
          kind: "content",
          line: Number(match[2]),
          text: (match[3] ?? "").trim().slice(0, 200)
        });
      }
    }
  }
  const ranked = sortSearchMatches(matches, needle);
  return {
    query: input.query,
    truncated: ranked.length > MAX_SEARCH_RESULTS,
    scanned: files.length,
    matches: ranked.slice(0, MAX_SEARCH_RESULTS)
  };
}

export async function searchProjectFiles(input: {
  rootPath: string;
  query: string;
  content?: boolean;
}): Promise<ProjectSearchResult> {
  const query = input.query.trim();
  if (!query) throw httpError(400, "搜索关键字不能为空");
  if (input.content && query.length < 2) {
    throw httpError(400, "内容搜索至少需要 2 个字符");
  }
  const gitResult = await searchGitProjectFiles({
    rootPath: input.rootPath,
    query,
    ...(input.content ? { content: true } : {})
  });
  if (gitResult) return gitResult;
  const canonicalRoot = await resolveProjectRoot(input.rootPath);
  const needle = query.toLowerCase();
  const matches: ProjectSearchMatch[] = [];
  let scanned = 0;
  let truncated = false;
  const queue = [canonicalRoot];

  while (queue.length > 0) {
    if (matches.length >= MAX_SEARCH_RESULTS) {
      truncated = true;
      break;
    }
    const current = queue.shift();
    if (!current) break;
    let dirents;
    try {
      dirents = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (matches.length >= MAX_SEARCH_RESULTS) {
        truncated = true;
        break;
      }
      if (SEARCH_IGNORE.has(dirent.name)) continue;
      const childPath = path.join(current, dirent.name);
      const relative = toPosix(path.relative(canonicalRoot, childPath));
      const type: ProjectSearchMatch["type"] = dirent.isSymbolicLink()
        ? "symlink"
        : dirent.isDirectory()
          ? "directory"
          : "file";
      scanned += 1;
      if (scanned > MAX_SEARCH_SCAN) {
        truncated = true;
        break;
      }
      if (dirent.name.toLowerCase().includes(needle) || relative.toLowerCase().includes(needle)) {
        matches.push({ path: relative, type, kind: "name" });
      }
      if (dirent.isDirectory() && !dirent.isSymbolicLink()) {
        queue.push(childPath);
        continue;
      }
      if (!input.content || type !== "file") continue;
      let info;
      try {
        info = await lstat(childPath);
      } catch {
        continue;
      }
      if (!info.isFile() || info.size > MAX_CONTENT_SEARCH_BYTES) continue;
      let buffer: Buffer;
      try {
        buffer = await readFile(childPath);
      } catch {
        continue;
      }
      if (!isProbablyText(buffer)) continue;
      const content = buffer.toString("utf8");
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!line.toLowerCase().includes(needle)) continue;
        matches.push({
          path: relative,
          type,
          kind: "content",
          line: index + 1,
          text: line.trim().slice(0, 200)
        });
        if (matches.length >= MAX_SEARCH_RESULTS) {
          truncated = true;
          break;
        }
      }
    }
    if (truncated) break;
  }

  return { query, truncated, scanned, matches: sortSearchMatches(matches, needle) };
}

async function listEntry(
  canonicalRoot: string,
  targetPath: string,
  fallbackPath: string
): Promise<ProjectDirectoryEntry> {
  const info = await lstat(targetPath);
  const relative = toPosix(path.relative(canonicalRoot, targetPath)) || fallbackPath;
  return {
    name: path.posix.basename(relative),
    path: relative,
    type: entryType(info),
    size: Number(info.size),
    mtimeMs: Math.trunc(info.mtimeMs),
    hidden: path.posix.basename(relative).startsWith(".")
  };
}
