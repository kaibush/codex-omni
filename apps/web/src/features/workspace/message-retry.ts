import { turnOptionsSchema } from "@codex-omni/protocol";
import type { Message, TimelineItem } from "@/types";

export async function messageRetryPayload(
  item: TimelineItem,
  loadMessage: (id: string) => Promise<Message>
) {
  if (item.kind !== "user") throw new Error("仅支持重试用户消息");
  // Timeline pages contain bounded previews. Always use the persisted message
  // rather than retrying a truncated prompt or truncated attachment metadata.
  const stored = item.messageId ? await loadMessage(item.messageId) : undefined;
  if (stored && stored.role !== "user") throw new Error("重试消息类型不匹配");
  if (!stored && item.data?.previewTruncated) throw new Error("请加载完整消息后重试");
  const data = stored ? (stored.dataJson ? JSON.parse(stored.dataJson) : {}) : (item.data ?? {});
  const attachments = turnOptionsSchema.shape.attachments.parse(data?.attachments) ?? [];
  return { message: stored?.content ?? item.text ?? "", attachments };
}
