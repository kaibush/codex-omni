import { useState } from "react";
import { ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  classifyRuntimeNotice,
  collabToolLabel,
  isCollabTool,
  isPlanTool,
  isUserInputTool,
  isViewImageTool,
  isWriteStdinTool
} from "@/lib/tool-event";
import type { TimelineItem } from "@/types";

const STORAGE_KEY = "codex-omni:timeline-outline";

function outlineTitle(item: TimelineItem) {
  if (item.kind === "user")
    return `你：${(item.text ?? "").split("\n")[0]?.slice(0, 24) || "消息"}`;
  if (item.kind === "assistant")
    return `Codex：${(item.text ?? "").split("\n")[0]?.slice(0, 24) || "回复"}`;
  if (item.kind === "file") return "文件：变更";
  if (item.kind === "approval") return "审批：待确认";
  if (item.kind === "reasoning") {
    return `思考：${(item.text ?? "").split("\n")[0]?.slice(0, 24) || "Thinking"}`;
  }
  if (item.kind === "error") {
    return `错误：${classifyRuntimeNotice(item.data, item.text, item.kind)?.title ?? "运行失败"}`;
  }
  if (item.kind === "tool") {
    const notice = classifyRuntimeNotice(item.data, item.text, item.kind);
    if (notice) return notice.title;
    if (isPlanTool(item.data)) return "计划";
    if (isCollabTool(item.data)) return collabToolLabel(item.data);
    if (isUserInputTool(item.data)) return "需要你选择";
    if (isViewImageTool(item.data)) return "查看图片";
    if (isWriteStdinTool(item.data)) return "向命令输入";
    return `命令：${String(item.data?.command ?? "工具调用").slice(0, 24)}`;
  }
  if (item.kind === "activity") {
    const grouped = Array.isArray(item.data?.items) ? item.data.items : [];
    return `执行：${grouped.length} 项操作`;
  }
  return item.kind;
}

function containsItem(item: TimelineItem, activeId?: string) {
  if (!activeId) return false;
  if (item.id === activeId) return true;
  return (
    Array.isArray(item.data?.items) &&
    item.data.items.some((child: TimelineItem) => child.id === activeId)
  );
}

function defaultOpen() {
  if (typeof window === "undefined") return false;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "open") return true;
  if (saved === "closed") return false;
  return window.innerWidth >= 1600 && window.innerHeight >= 800;
}

export function TimelineOutline({
  items,
  activeId,
  onJump
}: {
  items: TimelineItem[];
  activeId?: string;
  onJump: (id: string) => void;
}) {
  const entries = items.filter((item) =>
    ["user", "assistant", "activity", "tool", "file", "approval", "error", "reasoning"].includes(
      item.kind
    )
  );
  const [open, setOpen] = useState(defaultOpen);
  if (entries.length < 3) return null;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(STORAGE_KEY, next ? "open" : "closed");
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
        onClick={toggle}
      >
        <ListTree className="size-4" />
      </Button>
      {open ? (
        <nav className="timeline-outline is-open" aria-label="时间线目录">
          {entries.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={containsItem(item, activeId) ? "is-active" : undefined}
              title={outlineTitle(item)}
              onClick={() => onJump(item.id)}
            >
              <span className={`timeline-outline-index kind-${item.kind}`}>{index + 1}</span>
              <span className="min-w-0 truncate">{outlineTitle(item)}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </>
  );
}
