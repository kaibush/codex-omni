import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FilterChip } from "@/components/ui/filter-chip";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

type ApprovalStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";
type ApprovalItem = {
  id: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  sessionTitle: string;
  tool: string;
  command: string;
  status: ApprovalStatus;
  decision: string | null;
  createdAt: number;
  resolvedAt: number | null;
};
type ApprovalStats = {
  total: number;
  pending: number;
  accepted: number;
  declined: number;
  cancelled: number;
  expired: number;
};

const STATUS_LABEL: Record<ApprovalStatus | "", string> = {
  "": "全部",
  pending: "待处理",
  accepted: "已允许",
  declined: "已拒绝",
  cancelled: "已取消",
  expired: "已过期"
};

export function ApprovalAuditDialog({
  open,
  onOpenChange,
  projectId,
  sessionId,
  onOpenSession
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | undefined;
  sessionId?: string | undefined;
  onOpenSession: (projectId: string, sessionId: string) => void;
}) {
  const [status, setStatus] = useState<ApprovalStatus | "">("");
  const [scope, setScope] = useState<"project" | "session">("project");
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (scope === "session" && sessionId) params.set("sessionId", sessionId);
    if (status) params.set("status", status);
    return params.toString();
  }, [projectId, scope, sessionId, status]);
  const stats = useQuery({
    queryKey: ["approval-stats", projectId, scope, sessionId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (scope === "session" && sessionId) params.set("sessionId", sessionId);
      return api<ApprovalStats>(`/api/approvals/stats?${params}`);
    },
    enabled: open
  });
  const items = useQuery({
    queryKey: ["approvals", query],
    queryFn: () => api<ApprovalItem[]>(`/api/approvals?${query}`),
    enabled: open
  });
  const rows = items.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-3xl overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <ShieldQuestion className="size-4 text-primary" /> 审批审计
          </DialogTitle>
          <DialogDescription className="mt-1">
            按工程或当前会话筛选历史审批，并查看允许/拒绝统计。
          </DialogDescription>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
          <FilterChip active={scope === "project"} onClick={() => setScope("project")}>
            当前工程
          </FilterChip>
          <FilterChip
            active={scope === "session"}
            onClick={() => setScope("session")}
            disabled={!sessionId}
          >
            当前会话
          </FilterChip>
          {(Object.keys(STATUS_LABEL) as Array<ApprovalStatus | "">).map((value) => (
            <FilterChip
              key={value || "all"}
              active={status === value}
              onClick={() => setStatus(value)}
            >
              {STATUS_LABEL[value]}
            </FilterChip>
          ))}
        </div>
        <div className="min-h-0 overflow-y-auto p-3 sm:p-5">
          {stats.data ? (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {(
                [
                  ["全部", stats.data.total],
                  ["待处理", stats.data.pending],
                  ["已允许", stats.data.accepted],
                  ["已拒绝", stats.data.declined],
                  ["已取消", stats.data.cancelled],
                  ["已过期", stats.data.expired]
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs"
                >
                  <div className="text-muted-foreground">{label}</div>
                  <div className="text-lg font-semibold">{value}</div>
                </div>
              ))}
            </div>
          ) : null}
          {items.isPending ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> 正在读取审批记录
            </div>
          ) : rows.length ? (
            <div className="space-y-2">
              {rows.map((item) => (
                <article key={item.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.sessionTitle}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {item.command || item.tool}
                      </p>
                    </div>
                    <Badge variant="secondary">{STATUS_LABEL[item.status]}</Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        onOpenSession(item.projectId, item.sessionId);
                        onOpenChange(false);
                      }}
                    >
                      打开
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {item.projectName} · {formatDateTime(item.createdAt)}
                    {item.resolvedAt ? ` · 处理于 ${formatDateTime(item.resolvedAt)}` : ""}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">没有匹配的审批记录</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
