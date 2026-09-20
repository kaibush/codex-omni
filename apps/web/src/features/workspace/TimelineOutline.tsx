import { useState } from "react";
import { ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionOutlineItem } from "@/types";
import {
  defaultOutlineOpen,
  isCompactOutlineViewport,
  TIMELINE_OUTLINE_STORAGE_KEY
} from "@/features/workspace/timeline-outline";

function persistOutlineOpen(next: boolean) {
  try {
    localStorage.setItem(TIMELINE_OUTLINE_STORAGE_KEY, next ? "open" : "closed");
  } catch {
    // Ignore private-mode / storage failures.
  }
}

export function useTimelineOutline(items: SessionOutlineItem[]) {
  const [open, setOpen] = useState(() => defaultOutlineOpen());
  const setOutlineOpen = (next: boolean) => {
    setOpen(next);
    persistOutlineOpen(next);
  };
  const jump = (id: string, onJump: (id: string) => void) => {
    onJump(id);
    if (isCompactOutlineViewport()) setOutlineOpen(false);
  };
  return {
    open,
    hasItems: items.length > 0,
    setOutlineOpen,
    jump
  };
}

export function TimelineOutlineToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className={`timeline-outline-toggle ${open ? "is-open" : ""}`}
      aria-pressed={open}
      aria-label={open ? "收起对话大纲" : "打开对话大纲"}
      title={open ? "收起大纲" : "对话大纲"}
      onClick={onToggle}
    >
      <ListTree className="size-4" />
    </Button>
  );
}

export function TimelineOutlinePanel({
  open,
  items,
  activeId,
  onJump,
  onClose
}: {
  open: boolean;
  items: SessionOutlineItem[];
  activeId?: string | undefined;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  if (!open || items.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="timeline-outline-scrim"
        aria-label="关闭对话大纲"
        onClick={onClose}
      />
      <nav className="timeline-outline is-open" aria-label="对话大纲">
        <p className="timeline-outline-heading">对话大纲</p>
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={item.id === activeId ? "is-active" : undefined}
            title={item.title}
            onClick={() => onJump(item.id)}
          >
            <span className="timeline-outline-index kind-user">{index + 1}</span>
            <span className="min-w-0 truncate">{item.title}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

export function TimelineOutline({
  items,
  activeId,
  onJump
}: {
  items: SessionOutlineItem[];
  activeId?: string | undefined;
  onJump: (id: string) => void;
}) {
  const outline = useTimelineOutline(items);
  if (!outline.hasItems) return null;
  return (
    <>
      <TimelineOutlineToggle
        open={outline.open}
        onToggle={() => outline.setOutlineOpen(!outline.open)}
      />
      <TimelineOutlinePanel
        open={outline.open}
        items={items}
        activeId={activeId}
        onJump={(id) => outline.jump(id, onJump)}
        onClose={() => outline.setOutlineOpen(false)}
      />
    </>
  );
}
