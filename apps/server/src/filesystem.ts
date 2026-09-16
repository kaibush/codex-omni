import { createHash } from "node:crypto";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

export type FilesystemEntry = {
  name: string;
  path: string;
  readable: boolean;
  symlink: boolean;
};

export type FilesystemBrowse = {
  path: string;
  parent: string | null;
  roots: Array<{ name: string; path: string }>;
  breadcrumbs: Array<{ name: string; path: string }>;
  entries: FilesystemEntry[];
};

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

export function parseAllowedRoots(
  raw = process.env.CODEX_OMNI_FS_ROOTS ?? process.env.CODEX_OMNI_FS_ROOT
) {
  const roots = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));
  return roots.length > 0 ? roots : [path.parse(process.cwd()).root];
}

export function isPathInside(resolved: string, root: string) {
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return resolved === root || resolved.startsWith(normalizedRoot);
}

export function parentDirectory(resolved: string) {
  const parent = path.dirname(resolved);
  return parent === resolved ? null : parent;
}

export function breadcrumbs(resolved: string) {
  const parts: Array<{ name: string; path: string }> = [];
  let current = resolved;
  while (true) {
    const root = path.parse(current).root;
    parts.unshift({
      name: current === root ? current : path.basename(current),
      path: current
    });
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return parts;
}

export async function defaultBrowsePath(roots = parseAllowedRoots()) {
  const home = os.homedir();
  try {
    const resolvedHome = await realpath(home);
    if (roots.some((root) => isPathInside(resolvedHome, root))) return resolvedHome;
  } catch {
    // Fall through to the first readable root.
  }
  return roots[0] ?? path.parse(process.cwd()).root;
}

const rootLabel = (root: string) => {
  const parsed = path.parse(root).root;
  if (root === parsed) return root;
  return path.basename(root) || root;
};

export async function browseDirectory(
  inputPath?: string | undefined,
  roots = parseAllowedRoots()
): Promise<FilesystemBrowse> {
  const requested = inputPath?.trim()
    ? path.resolve(inputPath.trim())
    : await defaultBrowsePath(roots);
  let resolved: string;
  try {
    resolved = await realpath(requested);
  } catch {
    throw httpError(400, "目录不存在或无法访问");
  }
  if (!roots.some((root) => isPathInside(resolved, root))) {
    throw httpError(403, "路径不在允许的根目录内");
  }
  const info = await stat(resolved);
  if (!info.isDirectory()) throw httpError(400, "路径不是目录");

  let entries: FilesystemEntry[] = [];
  try {
    const dirents = await readdir(resolved, { withFileTypes: true });
    for (const entry of dirents) {
      const child = path.join(resolved, entry.name);
      const symlink = entry.isSymbolicLink();
      let isDirectory = entry.isDirectory();
      if (symlink || !isDirectory) {
        try {
          isDirectory = (await stat(child)).isDirectory();
        } catch {
          continue;
        }
      }
      if (!isDirectory) continue;
      let readable = true;
      try {
        await access(child, constants.R_OK);
      } catch {
        readable = false;
      }
      entries.push({ name: entry.name, path: child, readable, symlink });
    }
  } catch {
    entries = [];
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));

  const parent = parentDirectory(resolved);
  const listedRoots = await Promise.all(
    roots.map(async (root) => {
      try {
        const resolvedRoot = await realpath(root);
        return { name: rootLabel(resolvedRoot), path: resolvedRoot };
      } catch {
        return { name: rootLabel(root), path: root };
      }
    })
  );

  return {
    path: resolved,
    parent: parent && roots.some((root) => isPathInside(parent, root)) ? parent : null,
    roots: listedRoots,
    breadcrumbs: breadcrumbs(resolved),
    entries
  };
}


const MAX_EDITABLE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export type FilesystemFileMeta = {
  path: string;
  name: string;
  type: "file";
  size: number;
  mtimeMs: number;
  writable: boolean;
  revision: string | null;
  text: boolean;
};

export type FilesystemTextFile = {
  path: string;
  name: string;
  content: string;
  size: number;
  revision: string;
  writable: boolean;
};

export type FilesystemBinaryFile = {
  path: string;
  name: string;
  size: number;
  contentType: string;
  buffer: Buffer;
};

const CONTENT_TYPES: Record<string, string> = {
  aac: "audio/aac",
  avif: "image/avif",
  bmp: "image/bmp",
  flac: "audio/flac",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  md: "text/markdown; charset=utf-8",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp"
};

const revisionFor = (buffer: Buffer) => createHash("sha256").update(buffer).digest("base64url");
const toPosix = (value: string) => value.split(path.sep).join("/");

function contentTypeFor(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return (extension && CONTENT_TYPES[extension]) || "application/octet-stream";
}

function decodeTextFile(buffer: Buffer) {
  if (buffer.includes(0)) throw httpError(400, "二进制文件暂不支持在线查看");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw httpError(400, "文件不是有效的 UTF-8 文本，暂不支持在线查看");
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

async function resolveAllowedFile(inputPath: string, roots = parseAllowedRoots()) {
  const requested = inputPath.trim();
  if (!requested) throw httpError(400, "路径无效");
  if (requested.includes("\0")) throw httpError(400, "路径无效");
  if (!path.isAbsolute(requested)) throw httpError(400, "仅支持绝对路径");
  const absolute = path.resolve(requested);
  let resolved: string;
  try {
    resolved = await realpath(absolute);
  } catch {
    throw httpError(404, "文件不存在或无法访问");
  }
  if (!roots.some((root) => isPathInside(resolved, root))) {
    throw httpError(403, "路径不在允许的根目录内");
  }
  const info = await stat(resolved, { bigint: true });
  if (!info.isFile()) throw httpError(400, "路径不是文件");
  return { resolved, info };
}

export async function statFilesystemFile(
  inputPath: string,
  roots = parseAllowedRoots()
): Promise<FilesystemFileMeta> {
  const { resolved, info } = await resolveAllowedFile(inputPath, roots);
  const size = Number(info.size);
  let revision: string | null = `${Math.trunc(Number(info.mtimeMs))}:${size}`;
  let text = false;
  if (size <= MAX_EDITABLE_FILE_BYTES) {
    try {
      const buffer = await readFile(resolved);
      if (buffer.byteLength <= MAX_EDITABLE_FILE_BYTES && isProbablyText(buffer)) {
        revision = revisionFor(buffer);
        text = true;
      }
    } catch {
      // Keep the mtime-based revision for binary or unreadable files.
    }
  }
  return {
    path: toPosix(resolved),
    name: path.basename(resolved),
    type: "file",
    size,
    mtimeMs: Math.trunc(Number(info.mtimeMs)),
    writable: false,
    revision,
    text
  };
}

export async function readFilesystemTextFile(
  inputPath: string,
  roots = parseAllowedRoots()
): Promise<FilesystemTextFile> {
  const { resolved, info } = await resolveAllowedFile(inputPath, roots);
  if (Number(info.size) > MAX_EDITABLE_FILE_BYTES) {
    throw httpError(413, "文件超过 2 MB，暂不支持在线查看");
  }
  const buffer = await readFile(resolved);
  if (buffer.byteLength > MAX_EDITABLE_FILE_BYTES) {
    throw httpError(413, "文件超过 2 MB，暂不支持在线查看");
  }
  return {
    path: toPosix(resolved),
    name: path.basename(resolved),
    content: decodeTextFile(buffer),
    size: buffer.byteLength,
    revision: revisionFor(buffer),
    writable: false
  };
}

export async function readFilesystemBinaryFile(
  inputPath: string,
  roots = parseAllowedRoots()
): Promise<FilesystemBinaryFile> {
  const { resolved, info } = await resolveAllowedFile(inputPath, roots);
  if (Number(info.size) > MAX_DOWNLOAD_BYTES) {
    throw httpError(413, "文件超过 50 MB，暂不支持预览");
  }
  const buffer = await readFile(resolved);
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw httpError(413, "文件超过 50 MB，暂不支持预览");
  }
  return {
    path: toPosix(resolved),
    name: path.basename(resolved),
    size: buffer.byteLength,
    contentType: contentTypeFor(path.basename(resolved)),
    buffer
  };
}
