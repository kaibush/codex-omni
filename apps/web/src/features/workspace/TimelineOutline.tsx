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

export function TimelineOutline({
  items,
  activeId,
  onJump
}: {
  items: SessionOutlineItem[];
  activeId?: string;
  onJump: (id: string) => void;
}) {
  const [open, setOpen] = useState(() => defaultOutlineOpen());
  if (items.length === 0) return null;
  const setOutlineOpen = (next: boolean) => {
    setOpen(next);
    persistOutlineOpen(next);
  };
  const jump = (id: string) => {
    onJump(id);
    if (isCompactOutlineViewport()) setOutlineOpen(false);
  };
  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className={`timeline-outline-toggle ${open ? "is-open" : ""}`}
        aria-pressed={open}
        aria-label={open ? "收起对话大纲" : "打开对话大纲"}
        title={open ? "收起大纲" : "对话大纲"}
        onClick={() => setOutlineOpen(!open)}
      >
        <ListTree className="size-4" />
      </Button>
      {open ? (
        <>
          <button
            type="button"
            className="timeline-outline-scrim"
            aria-label="关闭对话大纲"
            onClick={() => setOutlineOpen(false)}
          />
          <nav className="timeline-outline is-open" aria-label="对话大纲">
            <p className="timeline-outline-heading">对话大纲</p>
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={item.id === activeId ? "is-active" : undefined}
                title={item.title}
                onClick={() => jump(item.id)}
              >
                <span className="timeline-outline-index kind-user">{index + 1}</span>
                <span className="min-w-0 truncate">{item.title}</span>
              </button>
            ))}
          </nav>
        </>
      ) : null}
    </>
  );
}
