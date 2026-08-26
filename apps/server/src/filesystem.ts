import { access, readdir, realpath, stat } from "node:fs/promises";
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
