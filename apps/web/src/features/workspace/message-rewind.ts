import type { Message } from "@/types";
import {
  timelineAttachments,
  visibleUserMessageText,
  type ComposerAttachment
} from "./composer-attachments";

export function messageRewindDraft(message: Message | null): {
  text: string;
  attachments: ComposerAttachment[];
} {
  if (!message) return { text: "", attachments: [] };
  let data: Record<string, unknown> = {};
  try {
    data = message.dataJson ? (JSON.parse(message.dataJson) ?? {}) : {};
  } catch {
    /* Preserve text from older messages with malformed metadata. */
  }
  return {
    text: visibleUserMessageText(message.content, data),
    attachments: timelineAttachments(data).map((file, index) => ({
      id: `rewind-${message.id}-${index}`,
      name: file.name,
      kind: file.kind,
      existingPath: file.path,
      size: 0,
      mime: "",
      bytes: new Uint8Array()
    }))
  };
}
