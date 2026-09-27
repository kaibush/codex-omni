import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { sanitizeAttachments } from "@codex-omni/agent-runtime";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TurnAttachment } from "@codex-omni/protocol";

const imageTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp"
} as const;

export async function claudeInput(
  message: string,
  cwd: string,
  attachments?: TurnAttachment[]
): Promise<SDKUserMessage> {
  const content: Exclude<SDKUserMessage["message"]["content"], string> = [
    { type: "text", text: message }
  ];
  for (const attachment of sanitizeAttachments(cwd, attachments)) {
    const mediaType =
      imageTypes[path.extname(attachment.path).toLowerCase() as keyof typeof imageTypes];
    if (attachment.kind === "image" && mediaType) {
      if ((await stat(attachment.path)).size > 5 * 1024 * 1024)
        throw new Error(`图片 ${attachment.name} 超过 Claude 的 5 MB 限制`);
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: (await readFile(attachment.path)).toString("base64")
        }
      });
    } else {
      content.push({
        type: "text",
        text: `附件 ${JSON.stringify(attachment.name)} 位于工程内 ${JSON.stringify(attachment.path)}，可按需使用文件工具读取。`
      });
    }
  }
  return {
    type: "user",
    uuid: randomUUID(),
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content }
  };
}

export class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private wake: (() => void) | undefined;
  private ended = false;
  push(message: SDKUserMessage) {
    if (this.ended) throw new Error("Claude Code 当前轮次已结束");
    this.items.push(message);
    this.wake?.();
  }
  close() {
    this.ended = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (!this.ended || this.items.length) {
      const item = this.items.shift();
      if (item) yield item;
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
    }
  }
}
