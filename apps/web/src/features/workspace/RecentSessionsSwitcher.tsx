import { ArrowUpDown, Check, History, LoaderCircle } from "lucide-react";
import { SessionIcon } from "@/components/SessionIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { type SessionListSort } from "@/lib/session-title";
import { formatCompactDateTime, formatDateTime } from "@/lib/utils";
import type { RecentRun } from "@/types";

export const recentRunStatusLabel: Record<RecentRun["status"], string> = {
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
  sort = "created",
  onSort,
  onOpen,
  onClose
}: {
  open: boolean;
  items: RecentRun[];
  pending: boolean;
  error: string;
  activeSessionId?: string | undefined;
  sort?: SessionListSort;
  onSort?: (sort: SessionListSort) => void;
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
        <div className="timeline-recent-heading">
          <p className="timeline-outline-heading">最近对话</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="timeline-recent-sort"
                aria-label="最近对话排序规则"
                title={sort === "updated" ? "更新时间" : "创建时间"}
              >
                <ArrowUpDown className="size-3.5 shrink-0" />
                <span>{sort === "updated" ? "更新时间" : "创建时间"}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem onSelect={() => onSort?.("created")}>
                创建时间
                {sort === "created" ? <Check className="ms-auto size-3.5" /> : null}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSort?.("updated")}>
                更新时间
                {sort === "updated" ? <Check className="ms-auto size-3.5" /> : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
              title={[item.sessionTitle, item.projectName, item.providerName]
                .filter(Boolean)
                .join(" · ")}
              onClick={() => onOpen(item.projectId, item.sessionId)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onOpen(item.projectId, item.sessionId);
              }}
            >
              <span className="timeline-recent-copy">
                <span className="flex min-w-0 items-center gap-1.5">
                  <SessionIcon session={item} className="size-3.5" labelled />
                  <span className="timeline-recent-title">{item.sessionTitle}</span>
                </span>
                <span className="timeline-recent-row">
                  <span className="timeline-recent-meta">
                    <span className="timeline-recent-project">{item.projectName}</span>
                    {item.providerName ? (
                      <span className="timeline-recent-provider">· {item.providerName}</span>
                    ) : null}
                  </span>
                  <span className={`timeline-recent-badge is-${item.status}`}>
                    {recentRunStatusLabel[item.status]}
                  </span>
                  <span
                    className="timeline-recent-time"
                    title={`${sort === "created" ? "创建于" : "更新于"} ${formatDateTime(
                      sort === "created" ? item.sessionCreatedAt : item.startedAt
                    )}`}
                  >
                    {formatCompactDateTime(sort === "created" ? item.sessionCreatedAt : item.startedAt)}
                  </span>
                </span>
              </span>
            </div>
          ))
        )}
      </nav>
    </>
  );
}
