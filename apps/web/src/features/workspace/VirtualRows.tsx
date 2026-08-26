import { useState, type ReactNode } from "react";

export function VirtualRows<T>({
  items,
  itemHeight,
  height,
  renderItem,
  overscan = 8,
  threshold = 48,
  disabled = false
}: {
  items: T[];
  itemHeight: number;
  height: number;
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  threshold?: number;
  disabled?: boolean;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  if (disabled || items.length < threshold) {
    return <>{items.map((item, index) => renderItem(item, index))}</>;
  }
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visible = Math.ceil(height / itemHeight) + overscan * 2;
  const end = Math.min(items.length, start + visible);
  return (
    <div
      className="virtual-rows"
      style={{ height }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: items.length * itemHeight, position: "relative" }}>
        <div style={{ position: "absolute", top: start * itemHeight, left: 0, right: 0 }}>
          {items.slice(start, end).map((item, index) => renderItem(item, start + index))}
        </div>
      </div>
    </div>
  );
}
