import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";
import {
  estimateTimelineItemSize,
  itemContainsId,
  shouldUpdateMeasuredHeight,
  shouldVirtualizeTimeline,
  stickyVisibleRange,
  visibleWindow
} from "./virtual-window";
import { TimelineErrorBoundary } from "./TimelineErrorBoundary";

const DEFAULT_THRESHOLD = 8;
const DEFAULT_OVERSCAN = 2;
const DEFAULT_OVERSCAN_PX = 480;
const ITEM_GAP = 12;
const STICKY_MAX = 12;

export function VirtualTimeline<
  T extends { id: string; kind: string; text?: string | undefined; data?: unknown }
>({
  items,
  scrollRef,
  stickToBottom,
  scrollToId,
  lockItemId,
  renderItem,
  overscan = DEFAULT_OVERSCAN,
  overscanPx = DEFAULT_OVERSCAN_PX,
  threshold = DEFAULT_THRESHOLD
}: {
  items: T[];
  scrollRef: RefObject<HTMLElement | null>;
  stickToBottom?: { current: boolean } | undefined;
  scrollToId?: string | undefined;
  lockItemId?: string | undefined;
  renderItem: (
    item: T,
    index: number,
    meta: { lite: boolean; height: number | undefined }
  ) => ReactNode;
  overscan?: number | undefined;
  overscanPx?: number | undefined;
  threshold?: number | undefined;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const sizeMap = useRef(new Map<string, number>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const stickyRef = useRef({ start: 0, end: 0 });
  const headId = items[0]?.id;
  const headIdRef = useRef(headId);
  if (headIdRef.current !== headId) {
    if (!lockItemId) stickyRef.current = { start: 0, end: 0 };
    headIdRef.current = headId;
  }
  const frameRef = useRef<number | null>(null);
  const [version, setVersion] = useState(0);

  const bump = useCallback((sync = false) => {
    if (sync) {
      setVersion((value) => value + 1);
      return;
    }
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setVersion((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    for (const id of sizeMap.current.keys()) {
      if (!ids.has(id)) sizeMap.current.delete(id);
    }
  }, [items]);

  useEffect(
    () => () => {
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    },
    []
  );

  const sizeOf = useCallback((index: number) => {
    const item = itemsRef.current[index];
    if (!item) return 72 + ITEM_GAP;
    const base = sizeMap.current.get(item.id) ?? estimateTimelineItemSize(item);
    return base + (index === itemsRef.current.length - 1 ? 0 : ITEM_GAP);
  }, []);

  const measure = useCallback(
    (id: string, height: number) => {
      const next = Math.round(height);
      const previous = sizeMap.current.get(id);
      if (!shouldUpdateMeasuredHeight(previous, next)) return;
      const index = itemsRef.current.findIndex((item) => item.id === id);
      const scroller = scrollRef.current;
      const listTop = listRef.current?.offsetTop ?? 0;
      if (
        scroller &&
        index >= 0 &&
        previous &&
        !stickToBottom?.current &&
        !lockItemId &&
        scroller.scrollTop + listTop > 0
      ) {
        let offset = listTop;
        for (let cursor = 0; cursor < index; cursor += 1) offset += sizeOf(cursor);
        if (offset < scroller.scrollTop) scroller.scrollTop += next - previous;
      }
      sizeMap.current.set(id, next);
      bump();
    },
    [bump, lockItemId, scrollRef, sizeOf, stickToBottom]
  );

  const virtualized = shouldVirtualizeTimeline(items, { threshold });
  const range = (() => {
    void version;
    if (!virtualized) {
      return {
        start: 0,
        end: items.length,
        tightStart: 0,
        tightEnd: items.length,
        paddingTop: 0,
        paddingBottom: 0,
        totalHeight: 0,
        virtualized: false
      };
    }
    const scroller = scrollRef.current;
    const viewportHeight = scroller?.clientHeight ?? 800;
    const listTop = listRef.current?.offsetTop ?? 0;
    // Pinning to the bottom must not wait for scrollTop. The first paint (and
    // the first 折叠/平铺/展开 remount) still has scrollTop=0, which would
    // window the oldest cards and leave a huge empty padding below.
    let scrollTop = stickToBottom?.current
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, (scroller?.scrollTop ?? 0) - listTop);
    if (lockItemId) {
      const index = items.findIndex((item) => itemContainsId(item, lockItemId));
      if (index >= 0) {
        let offset = 0;
        for (let cursor = 0; cursor < index; cursor += 1) offset += sizeOf(cursor);
        scrollTop = offset;
      }
    }
    let nextWindow = visibleWindow({
      itemCount: items.length,
      itemSize: sizeOf,
      scrollTop,
      viewportHeight,
      overscan,
      overscanPx
    });
    if (nextWindow.end <= nextWindow.start && items.length) {
      const fallback = Math.max(
        0,
        lockItemId
          ? Math.max(0, items.findIndex((item) => itemContainsId(item, lockItemId)))
          : stickToBottom?.current
            ? items.length - 1
            : 0
      );
      const start = Math.max(0, fallback - overscan);
      const end = Math.min(items.length, fallback + 1 + overscan);
      let paddingTop = 0;
      for (let index = 0; index < start; index += 1) paddingTop += sizeOf(index);
      let rendered = 0;
      for (let index = start; index < end; index += 1) rendered += sizeOf(index);
      nextWindow = {
        start,
        end,
        paddingTop,
        paddingBottom: Math.max(0, nextWindow.totalHeight - paddingTop - rendered),
        totalHeight: nextWindow.totalHeight
      };
    }
    const sticky = stickyVisibleRange(nextWindow, stickyRef.current, STICKY_MAX);
    stickyRef.current = sticky;
    let paddingTop = 0;
    for (let index = 0; index < sticky.start; index += 1) paddingTop += sizeOf(index);
    let rendered = 0;
    for (let index = sticky.start; index < sticky.end; index += 1) rendered += sizeOf(index);
    return {
      start: sticky.start,
      end: sticky.end,
      tightStart: nextWindow.start,
      tightEnd: nextWindow.end,
      paddingTop,
      paddingBottom: Math.max(0, nextWindow.totalHeight - paddingTop - rendered),
      totalHeight: nextWindow.totalHeight,
      virtualized: true
    };
  })();

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => bump();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => bump());
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [bump, scrollRef]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !stickToBottom?.current) return;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (Math.abs(scroller.scrollTop - maxScroll) < 2) return;
    scroller.scrollTop = maxScroll;
  }, [items, range.totalHeight, scrollRef, stickToBottom]);

  useEffect(() => {
    if (!scrollToId) return;
    const index = items.findIndex(
      (item) => item.id === scrollToId || item.id.endsWith(`-${scrollToId}`)
    );
    const scroller = scrollRef.current;
    if (index < 0 || !scroller) return;
    let offset = listRef.current?.offsetTop ?? 0;
    for (let cursor = 0; cursor < index; cursor += 1) offset += sizeOf(cursor);
    scroller.scrollTo({ top: Math.max(0, offset - scroller.clientHeight / 3) });
  }, [items, scrollRef, scrollToId, sizeOf]);

  const visible = items.slice(range.start, range.end);

  return (
    <div
      ref={listRef}
      className="flex min-w-0 flex-col"
      data-virtualized={range.virtualized ? "1" : "0"}
      data-virtual-start={String(range.start)}
      data-virtual-end={String(range.end)}
    >
      {range.virtualized ? <VirtualGap height={range.paddingTop} position="before" /> : null}
      {visible.map((item, offset) => {
        const index = range.start + offset;
        return (
          <VirtualTimelineItem
            key={item.id}
            id={item.id}
            last={index === items.length - 1}
            onMeasure={measure}
          >
            <TimelineErrorBoundary resetKey={item.id}>
              {renderItem(item, index, {
                lite: range.virtualized && (index < range.tightStart || index >= range.tightEnd),
                height: sizeMap.current.get(item.id)
              })}
            </TimelineErrorBoundary>
          </VirtualTimelineItem>
        );
      })}
      {range.virtualized ? <VirtualGap height={range.paddingBottom} position="after" /> : null}
    </div>
  );
}

function VirtualGap({ height, position }: { height: number; position: "before" | "after" }) {
  if (height <= 0) return null;
  return (
    <div
      className="virtual-timeline-gap"
      style={{ height }}
      aria-hidden
      data-virtual-gap={position}
    />
  );
}

function VirtualTimelineItem({
  id,
  last,
  onMeasure,
  children
}: {
  id: string;
  last: boolean;
  onMeasure: (id: string, height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const publish = () => onMeasure(id, node.getBoundingClientRect().height);
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [id, onMeasure]);
  return (
    <div ref={ref} data-virtual-id={id} className={last ? "min-w-0" : "mb-2.5 min-w-0 sm:mb-3"}>
      {children}
    </div>
  );
}
