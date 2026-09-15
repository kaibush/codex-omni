import type { SessionOutlineItem, TimelineItem } from "@/types";

export const TIMELINE_OUTLINE_STORAGE_KEY = "codex-omni:timeline-outline";

export function outlineTitleFromUserText(content: string) {
  const line = content
    .replace(/\r/g, "")
    .split("\n")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find(Boolean);
  return (line || "消息").slice(0, 48);
}

export function isCompactOutlineViewport(
  width = typeof window === "undefined" ? 1024 : window.innerWidth
) {
  return width < 768;
}

export function defaultOutlineOpen(options?: {
  width?: number;
  height?: number;
  saved?: string | null;
}) {
  const width = options?.width ?? (typeof window === "undefined" ? 0 : window.innerWidth);
  const height = options?.height ?? (typeof window === "undefined" ? 0 : window.innerHeight);
  if (isCompactOutlineViewport(width)) return false;
  const saved =
    options && "saved" in options
      ? options.saved
      : typeof window === "undefined"
        ? null
        : window.localStorage.getItem(TIMELINE_OUTLINE_STORAGE_KEY);
  if (saved === "open") return true;
  if (saved === "closed") return false;
  return width >= 1600 && height >= 800;
}

export function findTimelineItemByMessageId(events: TimelineItem[], messageId: string) {
  return events.find(
    (item) =>
      item.id === messageId ||
      item.messageId === messageId ||
      item.id.endsWith(`-${messageId}`)
  );
}

export function mergeSessionOutline(
  items: SessionOutlineItem[],
  events: TimelineItem[]
): SessionOutlineItem[] {
  const map = new Map(items.map((item) => [item.id, item]));
  for (const event of events) {
    if (event.kind !== "user") continue;
    const id = event.messageId || event.id;
    if (map.has(id)) continue;
    map.set(id, {
      id,
      title: outlineTitleFromUserText(event.text ?? ""),
      createdAt: event.createdAt ?? 0
    });
  }
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
