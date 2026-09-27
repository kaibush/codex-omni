import { resolveContainedAttachmentPath } from "@codex-omni/agent-runtime";
import path from "node:path";
import type { Input } from "@openai/codex-sdk";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

export type CodexRunAttachment = {
  name: string;
  path: string;
  kind: "image" | "text" | "file";
};

export function isCodexImageAttachment(item: CodexRunAttachment) {
  if (item.kind === "image") return true;
  return IMAGE_EXTENSIONS.has(path.extname(item.path).toLowerCase());
}

export { isPathInsideRoot, resolveContainedAttachmentPath } from "@codex-omni/agent-runtime";
export function sanitizeCodexAttachments(
  cwd: string,
  attachments: CodexRunAttachment[] | undefined
): CodexRunAttachment[] {
  return (attachments ?? []).map((item) => ({
    ...item,
    path: resolveContainedAttachmentPath(cwd, item.path)
  }));
}

export function buildCodexRunInput(
  message: string,
  attachments: CodexRunAttachment[] | undefined,
  cwd: string
): Input {
  const images = sanitizeCodexAttachments(cwd, attachments).filter(isCodexImageAttachment);
  if (!images.length) return message;
  return [
    { type: "text", text: message },
    ...images.map((item) => ({
      type: "local_image" as const,
      path: item.path
    }))
  ];
}
