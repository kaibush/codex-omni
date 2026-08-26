import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Clock3,
  Cpu,
  ExternalLink,
  LoaderCircle,
  Radio,
  Square,
  TerminalSquare,
  Users
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import type { ActiveRun, RunStats } from "@/types";

const duration = (startedAt: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}分${seconds % 60}秒` : `${seconds}秒`;
};

export function useActiveRuns(enabled = true) {
  return useQuery({
    queryKey: ["active-runs"],
    queryFn: () => api<ActiveRun[]>("/api/runs/active"),
    enabled,
    refetchInterval: enabled ? 3000 : false
  });
}

export function RunningCenterDialog({
  open,
  onOpenChange,
  onOpenSession
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSession: (projectId: string, sessionId: string) => void;
}) {
  const query = useActiveRuns(open);
  const stats = useQuery({
    queryKey: ["run-stats"],
    queryFn: () => api<RunStats>("/api/stats"),
    enabled: open
  });
  const queryClient = useQueryClient();
  const stop = async (run: ActiveRun) => {
    try {
      await api(`/api/runs/${run.sessionId}/cancel`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["active-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["sessions", run.projectId] });
      toast.success("已发送停止指令");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "停止任务失败");
    }
  };
  const runs = query.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-3xl overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Activity className="size-4 text-primary" /> 运行中心
          </DialogTitle>
          <DialogDescription className="mt-1">
            显示由当前 Server 实例实际管理的 Codex Worker，以及最近运行统计。
          </DialogDescription>
        </div>
        <div className="min-h-0 overflow-y-auto p-3 sm:p-5">
          {stats.data ? (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs">
                <div className="text-muted-foreground">Turn</div>
                <div className="text-lg font-semibold">{stats.data.turns}</div>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs">
                <div className="text-muted-foreground">完成 / 失败</div>
                <div className="text-lg font-semibold">
                  {stats.data.completed}/{stats.data.failed}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs">
                <div className="text-muted-foreground">Token</div>
                <div className="text-lg font-semibold">
                  {stats.data.totalTokens.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs">
                <div className="text-muted-foreground">耗时</div>
                <div className="text-lg font-semibold">
                  {Math.round(stats.data.durationMs / 1000)}s
                </div>
              </div>
            </div>
          ) : null}
          {query.isPending ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> 正在读取运行状态
            </div>
          ) : query.isError ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              {query.error instanceof Error ? query.error.message : "运行状态加载失败"}
            </div>
          ) : runs.length ? (
            <div className="space-y-3">
              {runs.map((run) => (
                <article key={run.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <span
                      className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ${
                        run.runtimeAlive
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      }`}
                    >
                      {run.runtimeAlive ? (
                        <Radio className="size-4" />
                      ) : (
                        <Activity className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="truncate text-sm">{run.sessionTitle}</b>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {run.runtimeAlive ? "确认执行中" : "状态待核对"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground" title={run.cwd}>
                        {run.projectName} · {run.providerName ?? "未命名 Provider"} · {run.cwd}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => {
                          onOpenSession(run.projectId, run.sessionId);
                          onOpenChange(false);
                        }}
                      >
                        <ExternalLink className="size-3.5" /> 打开
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8"
                        onClick={() => void stop(run)}
                      >
                        <Square className="size-3.5" /> 停止
                      </Button>
                    </div>
                  </div>
                  <dl className="mt-3 grid gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                    <div className="flex items-center gap-2">
                      <Clock3 className="size-3.5" />
                      <span title={formatDateTime(run.startedAt)}>
                        已运行 {duration(run.startedAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Cpu className="size-3.5" />
                      <span>
                        Worker {run.workerPid ?? "—"} · Codex {run.codexPid ?? "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="size-3.5" />
                      <span>浏览器订阅 {run.subscriberCount}</span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 sm:col-span-2">
                      <TerminalSquare className="size-3.5 shrink-0" />
                      <span className="truncate font-mono" title={run.threadId ?? run.id}>
                        thread {run.threadId ?? "等待创建"}
                      </span>
                    </div>
                    <div className="truncate font-mono" title={run.id}>
                      seq {run.lastSeq} · {run.id}
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <div className="grid place-items-center py-16 text-center">
              <span className="grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
                <Activity className="size-5" />
              </span>
              <b className="mt-3 text-sm">当前没有后台任务</b>
              <p className="mt-1 text-xs text-muted-foreground">
                运行中的 Codex turn 会显示在这里。
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
