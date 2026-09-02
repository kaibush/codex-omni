export type VirtualWindow = {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
  totalHeight: number;
};

export function visibleWindow(input: {
  itemCount: number;
  itemSize: (index: number) => number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
  overscanPx?: number;
}): VirtualWindow {
  const itemCount = Math.max(0, input.itemCount);
  const overscan = Math.max(0, input.overscan ?? 8);
  const overscanPx = Math.max(0, input.overscanPx ?? 0);
  if (itemCount === 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0, totalHeight: 0 };
  }

  const sizes = new Array<number>(itemCount);
  let totalHeight = 0;
  for (let index = 0; index < itemCount; index += 1) {
    const size = Math.max(1, input.itemSize(index));
    sizes[index] = size;
    totalHeight += size;
  }

  const viewportHeight = Math.max(0, input.viewportHeight);
  const scrollTop = Math.min(Math.max(0, input.scrollTop), Math.max(0, totalHeight - viewportHeight));
  const viewportStart = Math.max(0, scrollTop - overscanPx);
  const viewportEnd = scrollTop + viewportHeight + overscanPx;

  let offset = 0;
  let start = 0;
  while (start < itemCount && offset + (sizes[start] ?? 0) < viewportStart) {
    offset += sizes[start] ?? 0;
    start += 1;
  }
  start = Math.max(0, start - overscan);

  let paddingTop = 0;
  for (let index = 0; index < start; index += 1) paddingTop += sizes[index] ?? 0;

  let end = start;
  let seen = paddingTop;
  while (end < itemCount && seen < viewportEnd) {
    seen += sizes[end] ?? 0;
    end += 1;
  }
  end = Math.min(itemCount, end + overscan);

  let rendered = 0;
  for (let index = start; index < end; index += 1) rendered += sizes[index] ?? 0;
  return {
    start,
    end,
    paddingTop,
    paddingBottom: Math.max(0, totalHeight - paddingTop - rendered),
    totalHeight
  };
}

export function estimateTimelineItemSize(item: { kind: string; text?: string | undefined }) {
  if (item.kind === "user" || item.kind === "assistant") {
    const text = item.text ?? "";
    const lines = Math.max(text.split("\n").length, Math.ceil(text.length / 96));
    return Math.min(240, 84 + Math.min(lines, 8) * 16);
  }
  if (item.kind === "reasoning") return 48;
  if (item.kind === "activity") return 52;
  if (item.kind === "tool") return 56;
  if (item.kind === "approval") return 80;
  return 64;
}

export function shouldVirtualizeTimeline(
  items: Array<{ text?: string | undefined }>,
  options?: { threshold?: number; textBudget?: number; longItem?: number }
) {
  const threshold = options?.threshold ?? 8;
  const textBudget = options?.textBudget ?? 12_000;
  const longItem = options?.longItem ?? 8_000;
  if (items.length >= threshold) return true;
  let total = 0;
  for (const item of items) {
    const size = item.text?.length ?? 0;
    if (size >= longItem) return true;
    total += size;
    if (total >= textBudget) return true;
  }
  return false;
}

export function stickyVisibleRange(
  current: { start: number; end: number },
  previous: { start: number; end: number },
  maxItems = 18
) {
  if (previous.end <= previous.start) return current;
  if (current.start > previous.end || current.end < previous.start) return current;
  const start = Math.min(previous.start, current.start);
  const end = Math.max(previous.end, current.end);
  if (end - start <= maxItems) return { start, end };
  const span = Math.max(maxItems, current.end - current.start);
  let nextStart = current.start;
  let nextEnd = current.end;
  const extra = span - (nextEnd - nextStart);
  if (extra > 0) {
    const before = Math.min(current.start - start, Math.ceil(extra / 2));
    nextStart = current.start - before;
    nextEnd = nextStart + span;
    if (nextEnd > end) {
      nextEnd = end;
      nextStart = Math.max(start, nextEnd - span);
    }
  }
  return {
    start: Math.min(nextStart, current.start),
    end: Math.max(nextEnd, current.end)
  };
}
