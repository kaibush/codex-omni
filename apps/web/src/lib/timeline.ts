import type { TimelineItem } from "@/types";

const isActivityItem = (item: TimelineItem) => item.kind === "tool" || item.kind === "file";

/** Collapse noisy streamed event runs without changing the persisted timeline. */
export function compactTimelineEvents(items: TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  let index = 0;
  while (index < items.length) {
    const current = items[index]!;
    if (current.kind === "reasoning") {
      const group = [current];
      let next = index + 1;
      while (next < items.length) {
        const candidate = items[next]!;
        if (candidate.kind !== "reasoning") break;
        group.push(candidate);
        next += 1;
      }
      if (group.length > 1) {
        result.push({
          id: `reasoning-group-${current.id}`,
          kind: "reasoning",
          text: group
            .map((item) => item.text?.trim())
            .filter(Boolean)
            .join("\n\n"),
          data: { grouped: true, items: group },
          ...(current.providerId !== undefined ? { providerId: current.providerId } : {}),
          streaming: group.some((item) => item.streaming),
          ...(current.createdAt !== undefined ? { createdAt: current.createdAt } : {})
        });
      } else result.push(current);
      index = next;
      continue;
    }
    if (isActivityItem(current)) {
      const group = [current];
      let next = index + 1;
      while (next < items.length) {
        const candidate = items[next]!;
        if (!isActivityItem(candidate)) break;
        group.push(candidate);
        next += 1;
      }
      if (group.length > 1) {
        result.push({
          id: `activity-group-${current.id}`,
          kind: "activity",
          data: { grouped: true, items: group },
          ...(current.providerId !== undefined ? { providerId: current.providerId } : {}),
          streaming: group.some((item) => item.streaming),
          ...(current.createdAt !== undefined ? { createdAt: current.createdAt } : {})
        });
      } else result.push(current);
      index = next;
      continue;
    }
    result.push(current);
    index += 1;
  }
  return result;
}

export function mergeSessionTimeline(input: {
  historical: TimelineItem[];
  current: TimelineItem[];
  historyExpanded: boolean;
}): TimelineItem[] {
  const historicalIds = new Set(input.historical.map((item) => item.id));
  const extras = input.current.filter((item) => !historicalIds.has(item.id));
  let firstHistoricalIndex = -1;
  let lastHistoricalIndex = -1;
  input.current.forEach((item, index) => {
    if (!historicalIds.has(item.id)) return;
    if (firstHistoricalIndex < 0) firstHistoricalIndex = index;
    lastHistoricalIndex = index;
  });
  const oldestCreatedAt = input.historical[0]?.createdAt ?? 0;
  const newestCreatedAt = input.historical.at(-1)?.createdAt ?? 0;
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
    if (afterHistoricalIds.has(item.id)) return true;
    if (item.streaming) return true;
    if (item.kind === "error") return true;
    return (item.createdAt ?? 0) > newestCreatedAt;
  });
  return [...older, ...input.historical, ...inFlight];
}
