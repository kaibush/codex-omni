import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

export async function resolveProjectDirectory(inputPath: string) {
  const displayPath = inputPath.trim();
  if (!displayPath) throw httpError(400, "请输入工程路径");
  let realPath: string;
  try {
    realPath = await realpath(displayPath);
  } catch {
    throw httpError(400, "工程路径不存在或无法访问");
  }
  let info;
  try {
    info = await stat(realPath);
  } catch {
    throw httpError(400, "工程路径不存在或无法访问");
  }
  if (!info.isDirectory()) throw httpError(400, "工程路径不是目录");
  return { displayPath, realPath };
}

export function remapContainedPath(cwd: string, fromRoot: string, toRoot: string) {
  const from =
    fromRoot.length > 1 && fromRoot.endsWith(path.sep) ? fromRoot.slice(0, -1) : fromRoot;
  const to = toRoot.length > 1 && toRoot.endsWith(path.sep) ? toRoot.slice(0, -1) : toRoot;
  if (cwd === from) return to;
  const prefix = from.endsWith(path.sep) ? from : `${from}${path.sep}`;
  if (!cwd.startsWith(prefix)) return cwd;
  return `${to}${cwd.slice(from.length)}`;
}
