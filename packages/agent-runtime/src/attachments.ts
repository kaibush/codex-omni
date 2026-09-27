import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { TurnAttachment } from "@codex-omni/protocol";

export function isPathInsideRoot(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function resolveContainedAttachmentPath(cwd: string, filePath: string) {
  if (!filePath.trim() || filePath.includes("\0")) {
    throw new Error("Attachment path is invalid");
  }
  let root: string;
  try {
    root = realpathSync(cwd);
  } catch {
    throw new Error("Project directory does not exist");
  }
  const resolved = path.resolve(cwd, filePath);
  // Permit the project's own symlink spelling as well as its canonical path,
  // but reject lexical traversal before inspecting any outside file.
  if (!isPathInsideRoot(path.resolve(cwd), resolved) && !isPathInsideRoot(root, resolved)) {
    throw new Error("Attachment path must stay inside the project");
  }
  let candidate: string;
  try {
    candidate = realpathSync(resolved);
  } catch {
    throw new Error("Attachment file not found");
  }
  if (!isPathInsideRoot(root, candidate)) {
    throw new Error("Attachment path must stay inside the project");
  }
  if (!statSync(candidate).isFile()) {
    throw new Error("Attachment file not found");
  }
  return candidate;
}

export function sanitizeAttachments(cwd: string, attachments?: TurnAttachment[]): TurnAttachment[] {
  return (attachments ?? []).map((item) => ({
    ...item,
    path: resolveContainedAttachmentPath(cwd, item.path)
  }));
}
