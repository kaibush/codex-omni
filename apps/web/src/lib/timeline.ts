import {
  isRuntimePlaceholder,
  isStandaloneTimelineTool,
  mergeToolEventData
} from "@/lib/tool-event";
import type { TimelineItem } from "@/types";

export const TIMELINE_VIEWS = ["folded", "flat", "expanded"] as const;
export type TimelineView = (typeof TIMELINE_VIEWS)[number];

export const TIMELINE_VIEW_OPTIONS: Array<{ value: TimelineView; label: string; hint: string }> = [
  { value: "folded", label: "折叠", hint: "合并思考和连续执行，适合日常查看" },
  { value: "flat", label: "平铺", hint: "按原始顺序列出全部 Think 和工具，卡片保持收起" },
  { value: "expanded", label: "展开", hint: "列出全部原始事件，并默认打开卡片详情" }
];

export function isTimelineView(value: unknown): value is TimelineView {
  return value === "folded" || value === "flat" || value === "expanded";
}

const isActivityItem = (item: TimelineItem) =>
  item.kind === "file" ||
  (item.kind === "tool" && !isStandaloneTimelineTool(item.data, item.text, item.kind));

const isReasoningItem = (item: TimelineItem) => item.kind === "reasoning";

const isBarrierItem = (item: TimelineItem) =>
  item.kind === "user" ||
  item.kind === "assistant" ||
  item.kind === "system" ||
  item.kind === "error" ||
  item.kind === "approval";

function groupedReasoning(items: TimelineItem[]): TimelineItem {
  const first = items[0]!;
  if (items.length === 1) return first;
  return {
    id: `reasoning-group-${first.id}`,
    kind: "reasoning",
    text: items
      .map((item) => item.text?.trim())
      .filter(Boolean)
      .join("\n\n"),
    data: { grouped: true, items },
    ...(first.providerId !== undefined ? { providerId: first.providerId } : {}),
    streaming: items.some((item) => item.streaming),
    ...(first.createdAt !== undefined ? { createdAt: first.createdAt } : {})
  };
}

function groupedActivity(items: TimelineItem[]): TimelineItem {
  const first = items[0]!;
  if (items.length === 1) return first;
  return {
    id: `activity-group-${first.id}`,
    kind: "activity",
    data: { grouped: true, items },
    ...(first.providerId !== undefined ? { providerId: first.providerId } : {}),
    streaming: items.some((item) => item.streaming),
    ...(first.createdAt !== undefined ? { createdAt: first.createdAt } : {})
  };
}

function compactActivity(items: TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  let index = 0;
  while (index < items.length) {
    const current = items[index]!;
    if (!isActivityItem(current)) {
      result.push(current);
      index += 1;
      continue;
    }
    const group = [current];
    let next = index + 1;
    while (next < items.length && isActivityItem(items[next]!)) {
      group.push(items[next]!);
      next += 1;
    }
    result.push(groupedActivity(group));
    index = next;
  }
  return result;
}

function compactSegment(items: TimelineItem[]): TimelineItem[] {
  const firstReasoning = items.findIndex(isReasoningItem);
  if (firstReasoning < 0) return compactActivity(items);
  const reasoning = items.filter(isReasoningItem);
  const rest = items.filter((item) => !isReasoningItem(item));
  const insertAt = items.slice(0, firstReasoning).filter((item) => !isReasoningItem(item)).length;
  return [
    ...compactActivity(rest.slice(0, insertAt)),
    groupedReasoning(reasoning),
    ...compactActivity(rest.slice(insertAt))
  ];
}

/** Collapse noisy streamed event runs without changing the persisted timeline. */
export function compactTimelineEvents(items: TimelineItem[]): TimelineItem[] {
  const visible = items.filter((item) => !isRuntimePlaceholder(item.data, item.text));
  const result: TimelineItem[] = [];
  let index = 0;
  while (index < visible.length) {
    const current = visible[index]!;
    if (isBarrierItem(current)) {
      result.push(current);
      index += 1;
      continue;
    }
    let next = index + 1;
    while (next < visible.length && !isBarrierItem(visible[next]!)) next += 1;
    result.push(...compactSegment(visible.slice(index, next)));
    index = next;
  }
  return result;
}

export const LIVE_TIMELINE_TAIL_ITEMS = 80;
export const LIVE_TIMELINE_MAX_CHARS = 480_000;
export const LIVE_TIMELINE_FLUSH_MS = 180;
export const LIVE_TIMELINE_FLUSH_MAX_BATCH = 40;
export const HISTORY_TIMELINE_MAX_ITEMS = 180;
export const HISTORY_TIMELINE_MAX_CHARS = 1_200_000;

function timelineItemSize(item: TimelineItem) {
  return (item.text?.length ?? 0) + payloadSize(item.data);
}

function payloadSize(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value !== "object") return 8;
  if (Array.isArray(value)) {
    let size = 0;
    for (const entry of value) size += payloadSize(entry);
    return size;
  }
  let size = 0;
  for (const entry of Object.values(value as Record<string, unknown>)) size += payloadSize(entry);
  return size;
}

/** Keep a bounded window so hours-long chats cannot retain the whole session in RAM. */
export function capTimelineEvents(
  items: TimelineItem[],
  options?: { keep?: "tail" | "head"; maxItems?: number; maxChars?: number }
): TimelineItem[] {
  const keep = options?.keep ?? "tail";
  const maxItems = options?.maxItems ?? LIVE_TIMELINE_TAIL_ITEMS;
  const maxChars = options?.maxChars ?? LIVE_TIMELINE_MAX_CHARS;
  if (items.length <= maxItems) {
    let chars = 0;
    for (const item of items) {
      chars += timelineItemSize(item);
      if (chars > maxChars) break;
    }
    if (chars <= maxChars) return items;
  }
  if (keep === "head") {
    let chars = 0;
    let end = 0;
    while (end < items.length && end < maxItems) {
      const size = timelineItemSize(items[end]!);
      if (end > 0 && chars + size > maxChars) break;
      chars += size;
      end += 1;
    }
    return end >= items.length ? items : items.slice(0, Math.max(1, end));
  }
  let chars = 0;
  let start = items.length;
  while (start > 0 && items.length - (start - 1) <= maxItems) {
    const size = timelineItemSize(items[start - 1]!);
    if (items.length - start > 0 && chars + size > maxChars) break;
    chars += size;
    start -= 1;
  }
  const minStart = Math.max(0, items.length - maxItems - 24);
  for (let index = start; index > minStart; index -= 1) {
    if (items[index]?.kind === "user") {
      start = index;
      break;
    }
  }
  return start <= 0 ? items : items.slice(start);
}

/** Keep the oldest loaded edge stable while the user is browsing history. */
export function capHistoryTimelineEvents(items: TimelineItem[]): TimelineItem[] {
  return capTimelineEvents(items, {
    keep: "head",
    maxItems: HISTORY_TIMELINE_MAX_ITEMS,
    maxChars: HISTORY_TIMELINE_MAX_CHARS
  });
}

export function displayTimelineEvents(
  items: TimelineItem[],
  view: TimelineView = "folded"
): TimelineItem[] {
  if (view === "folded") return compactTimelineEvents(items);
  return items.filter((item) => !isRuntimePlaceholder(item.data, item.text));
}

export function mergeSessionTimeline(input: {
  historical: TimelineItem[];
  current: TimelineItem[];
  historyExpanded: boolean;
}): TimelineItem[] {
  const liveById = new Map(input.current.map((item) => [item.id, item]));
  const historical = input.historical.map((item) => {
    const live = liveById.get(item.id);
    if (!live) return item;
    const merged: TimelineItem = {
      ...item,
      data: mergeToolEventData(live.data, item.data)
    };
    const text = live.text || item.text;
    if (text) merged.text = text;
    if (live.streaming != null) merged.streaming = live.streaming;
    else if (item.streaming != null) merged.streaming = item.streaming;
    return merged;
  });
  const historicalIds = new Set(historical.map((item) => item.id));
  const extras = input.current.filter((item) => !historicalIds.has(item.id));
  let firstHistoricalIndex = -1;
  let lastHistoricalIndex = -1;
  input.current.forEach((item, index) => {
    if (!historicalIds.has(item.id)) return;
    if (firstHistoricalIndex < 0) firstHistoricalIndex = index;
    lastHistoricalIndex = index;
  });
  const oldestCreatedAt = historical[0]?.createdAt ?? 0;
  const newestCreatedAt = historical.at(-1)?.createdAt ?? 0;
  const older = input.historyExpanded
    ? firstHistoricalIndex >= 0
      ? input.current.slice(0, firstHistoricalIndex).filter((item) => !historicalIds.has(item.id))
      : extras.filter((item) => (item.createdAt ?? 0) <= oldestCreatedAt)
    : [];
  const olderIds = new Set(older.map((item) => item.id));
  const afterHistoricalIds = new Set(
    lastHistoricalIndex >= 0
      ? input.current
          .slice(lastHistoricalIndex + 1)
          .filter((item) => !historicalIds.has(item.id))
          .map((item) => item.id)
      : []
  );
  const inFlight = extras.filter((item) => {
    if (olderIds.has(item.id)) return false;
    // A terminal error that predates the fetched page is historical, even if
    // it was appended to the live stream after the page's newest item.
    if (
      item.kind === "error" &&
      newestCreatedAt > 0 &&
      (item.createdAt ?? 0) <= newestCreatedAt
    ) {
      return false;
    }
    if (afterHistoricalIds.has(item.id)) return true;
    if (item.streaming && (item.kind === "assistant" || item.kind === "tool")) return true;
    return (item.createdAt ?? 0) > newestCreatedAt;
  });
  return [...older, ...historical, ...inFlight];
}
