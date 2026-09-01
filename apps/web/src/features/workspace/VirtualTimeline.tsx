import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";
import { estimateTimelineItemSize, shouldVirtualizeTimeline, stickyVisibleRange, visibleWindow } from "./virtual-window";

const DEFAULT_THRESHOLD = 8;
const DEFAULT_OVERSCAN = 6;
const DEFAULT_OVERSCAN_PX = 1800;
const ITEM_GAP = 12;

export function VirtualTimeline<T extends { id: string; kind: string; text?: string | undefined }>({
  items,
  scrollRef,
  stickToBottom,
  scrollToId,
  renderItem,
  overscan = DEFAULT_OVERSCAN,
  overscanPx = DEFAULT_OVERSCAN_PX,
  threshold = DEFAULT_THRESHOLD
}: {
  items: T[];
  scrollRef: RefObject<HTMLElement | null>;
  stickToBottom?: { current: boolean } | undefined;
  scrollToId?: string | undefined;
  renderItem: (item: T, index: number) => ReactNode;
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
    stickyRef.current = { start: 0, end: 0 };
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
      const previous = sizeMap.current.get(id);
      if (previous === height || height <= 0) return;
      const index = itemsRef.current.findIndex((item) => item.id === id);
      const scroller = scrollRef.current;
      const listTop = listRef.current?.offsetTop ?? 0;
      if (
        scroller &&
        index >= 0 &&
        previous &&
        !stickToBottom?.current &&
        scroller.scrollTop + listTop > 0
      ) {
        let offset = listTop;
        for (let cursor = 0; cursor < index; cursor += 1) offset += sizeOf(cursor);
        if (offset < scroller.scrollTop) scroller.scrollTop += height - previous;
      }
      sizeMap.current.set(id, height);
      bump(true);
    },
    [bump, scrollRef, sizeOf, stickToBottom]
  );

  const virtualized = shouldVirtualizeTimeline(items, { threshold });
  const range = (() => {
    void version;
    if (!virtualized) {
      return {
        start: 0,
        end: items.length,
        paddingTop: 0,
        paddingBottom: 0,
        totalHeight: 0,
        virtualized: false
      };
    }
    const scroller = scrollRef.current;
    const viewportHeight = scroller?.clientHeight ?? 800;
    const listTop = listRef.current?.offsetTop ?? 0;
    const scrollTop = Math.max(0, (scroller?.scrollTop ?? 0) - listTop);
    const nextWindow = visibleWindow({
      itemCount: items.length,
      itemSize: sizeOf,
      scrollTop,
      viewportHeight,
      overscan,
      overscanPx
    });
    const sticky = stickyVisibleRange(nextWindow, stickyRef.current);
    stickyRef.current = sticky;
    if (sticky.start === nextWindow.start && sticky.end === nextWindow.end) {
      return { ...nextWindow, virtualized: true };
    }
    let paddingTop = 0;
    for (let index = 0; index < sticky.start; index += 1) paddingTop += sizeOf(index);
    let rendered = 0;
    for (let index = sticky.start; index < sticky.end; index += 1) rendered += sizeOf(index);
    return {
      start: sticky.start,
      end: sticky.end,
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
      {range.virtualized ? (
        <VirtualGap height={range.paddingTop} position="before" />
      ) : null}
      {visible.map((item, offset) => {
        const index = range.start + offset;
        return (
          <VirtualTimelineItem
            key={item.id}
            id={item.id}
            last={index === items.length - 1}
            onMeasure={measure}
          >
            {renderItem(item, index)}
          </VirtualTimelineItem>
        );
      })}
      {range.virtualized ? (
        <VirtualGap height={range.paddingBottom} position="after" />
      ) : null}
    </div>
  );
}

function VirtualGap({ height, position }: { height: number; position: "before" | "after" }) {
  if (height <= 0) return null;
  return <div className="virtual-timeline-gap" style={{ height }} aria-hidden data-virtual-gap={position} />;
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
