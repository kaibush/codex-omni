import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock3, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import type { ScheduledJob } from "@/types";

export function ScheduleDialog({
  open,
  onOpenChange,
  projectId,
  sessionId
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  sessionId?: string;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] = useState<ScheduledJob["cadence"]>("daily");
  const [dailyAt, setDailyAt] = useState("09:00");
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const jobs = useQuery({
    queryKey: ["schedules", projectId],
    queryFn: () => api<ScheduledJob[]>(`/api/projects/${projectId}/schedules`),
    enabled: open && Boolean(projectId)
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/schedules`, {
        method: "POST",
        body: JSON.stringify({
          title,
          prompt,
          cadence,
          dailyAt: cadence === "daily" ? dailyAt : undefined,
          intervalMinutes: cadence === "interval" ? Number(intervalMinutes) : undefined,
          sessionId
        })
      }),
    onSuccess: async () => {
      setTitle("");
      setPrompt("");
      await qc.invalidateQueries({ queryKey: ["schedules", projectId] });
      toast.success("已保存定时任务");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存失败")
  });
  const toggle = useMutation({
    mutationFn: (job: ScheduledJob) =>
      api(`/api/schedules/${job.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: job.title,
          prompt: job.prompt,
          cadence: job.cadence,
          intervalMinutes: job.intervalMinutes,
          dailyAt: job.dailyAt,
          sessionId: job.sessionId,
          enabled: !job.enabled
        })
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", projectId] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/schedules/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", projectId] })
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] sm:w-[min(92vw,720px)]">
        <DialogTitle className="flex items-center gap-2">
          <Clock3 className="size-4" /> 定时任务
        </DialogTitle>
        <DialogDescription>
          到点后把 Prompt 写入 Session 并排队执行，不发送浏览器通知。
        </DialogDescription>
        <div className="mt-4 space-y-2">
          {(jobs.data ?? []).map((job) => (
            <div key={job.id} className="flex items-start gap-2 rounded-xl border bg-card p-3">
              <Switch
                checked={job.enabled}
                onCheckedChange={() => toggle.mutate(job)}
                aria-label={`启用 ${job.title}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{job.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {job.cadence === "daily"
                    ? `每天 ${job.dailyAt}`
                    : `每 ${job.intervalMinutes} 分钟`}
                  {job.nextRunAt ? ` · 下次 ${formatDateTime(job.nextRunAt)}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`删除 ${job.title}`}
                onClick={() => remove.mutate(job.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <div className="rounded-xl border bg-muted/40 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="field-label">
                名称
                <input
                  className="field"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="每日测试"
                />
              </label>
              <label className="field-label">
                周期
                <select
                  className="field"
                  value={cadence}
                  onChange={(event) => setCadence(event.target.value as ScheduledJob["cadence"])}
                >
                  <option value="daily">每天</option>
                  <option value="interval">间隔分钟</option>
                </select>
              </label>
            </div>
            {cadence === "daily" ? (
              <label className="field-label mt-2">
                时间
                <input
                  className="field"
                  value={dailyAt}
                  onChange={(event) => setDailyAt(event.target.value)}
                  placeholder="09:00"
                />
              </label>
            ) : (
              <label className="field-label mt-2">
                间隔（分钟）
                <input
                  className="field"
                  value={intervalMinutes}
                  onChange={(event) => setIntervalMinutes(event.target.value)}
                />
              </label>
            )}
            <label className="field-label mt-2">
              Prompt
              <textarea
                className="field min-h-20"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="请运行测试并汇报结果"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              disabled={!title.trim() || !prompt.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              <Plus className="size-4" /> 保存定时任务
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
