import type { MessageRow } from "@codex-omni/db";

const DUPLICATE_CONTENT_FIELDS = ["text", "output", "message"] as const;

export function compactMessageForClient(message: MessageRow): MessageRow {
  if (!message.dataJson) return message;
  try {
    const data = JSON.parse(message.dataJson) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return message;
    const record = data as Record<string, unknown>;
    let changed = false;
    for (const field of DUPLICATE_CONTENT_FIELDS) {
      if (record[field] === message.content) {
        delete record[field];
        changed = true;
      }
    }
    if (!changed) return message;
    return {
      ...message,
      dataJson: Object.keys(record).length ? JSON.stringify(record) : null
    };
  } catch {
    return message;
  }
}
