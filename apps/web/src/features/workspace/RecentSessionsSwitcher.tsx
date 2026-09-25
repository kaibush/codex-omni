import { History, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCompactDateTime } from "@/lib/utils";
import type { RecentRun } from "@/types";

const recentRunStatusLabel: Record<RecentRun["status"], string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断"
};

export function RecentSessionsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className={`timeline-recent-toggle ${open ? "is-open" : ""}`}
      aria-pressed={open}
      aria-expanded={open}
      aria-label={open ? "收起最近对话" : "最近对话"}
      title={open ? "收起最近对话" : "最近对话"}
      onClick={onToggle}
    >
      <History className="size-4" />
    </Button>
  );
}

export function RecentSessionsPanel({
  open,
  items,
  pending,
  error,
  activeSessionId,
  onOpen,
  onClose
}: {
  open: boolean;
  items: RecentRun[];
  pending: boolean;
  error: string;
  activeSessionId?: string | undefined;
  onOpen: (projectId: string, sessionId: string) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        className="timeline-outline-scrim"
        aria-label="关闭最近对话"
        onClick={onClose}
      />
      <nav className="timeline-outline timeline-recent is-open" aria-label="最近对话">
        <p className="timeline-outline-heading">最近对话</p>
        {pending ? (
          <p className="timeline-recent-status">
            <LoaderCircle className="size-3.5 animate-spin" /> 正在读取最近对话
          </p>
        ) : items.length === 0 ? (
          <p className="timeline-recent-status">{error || "暂无最近对话"}</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              className={`timeline-recent-item${item.sessionId === activeSessionId ? " is-active" : ""}`}
              title={`${item.sessionTitle} · ${item.projectName}`}
              onClick={() => onOpen(item.projectId, item.sessionId)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onOpen(item.projectId, item.sessionId);
              }}
            >
              <span className="timeline-recent-copy">
                <span className="timeline-recent-title">{item.sessionTitle}</span>
                <span className="timeline-recent-row">
                  <span className="timeline-recent-project">{item.projectName}</span>
                  <span className={`timeline-recent-badge is-${item.status}`}>
                    {recentRunStatusLabel[item.status]}
                  </span>
                  <span className="timeline-recent-time">{formatCompactDateTime(item.startedAt)}</span>
                </span>
              </span>
            </div>
          ))
        )}
      </nav>
    </>
  );
}
