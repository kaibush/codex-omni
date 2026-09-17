import type { TimelineItem } from "@/types";

/** Match the history API's ORDER BY created_at,id (SQLite binary collation). */
export function compareTimelineItems(left: TimelineItem, right: TimelineItem) {
  const time = (left.createdAt ?? 0) - (right.createdAt ?? 0);
  if (time) return time;
  if (!left.messageId || !right.messageId) return 0;
  return left.messageId < right.messageId ? -1 : left.messageId > right.messageId ? 1 : 0;
}

export function compareTimelineVersions(
  left: Pick<TimelineItem, "eventSeq" | "updatedAt">,
  right: Pick<TimelineItem, "eventSeq" | "updatedAt">
) {
  if (left.eventSeq != null && right.eventSeq != null && left.eventSeq !== right.eventSeq) {
    return left.eventSeq - right.eventSeq;
  }
  if (left.updatedAt != null && right.updatedAt != null) return left.updatedAt - right.updatedAt;
  return 0;
}

export function timelineEventMetadata(payload: Record<string, unknown>) {
  return {
    ...(typeof payload.messageId === "string" ? { messageId: payload.messageId } : {}),
    ...(typeof payload.createdAt === "number" ? { createdAt: payload.createdAt } : {}),
    ...(typeof payload.updatedAt === "number" ? { updatedAt: payload.updatedAt } : {}),
    ...(typeof payload.eventSeq === "number" ? { eventSeq: payload.eventSeq } : {})
  };
}
