import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckSquare, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { WorkspaceTask } from "@/types";

const COLUMNS: Array<{ status: WorkspaceTask["status"]; label: string }> = [
  { status: "todo", label: "待处理" },
  { status: "doing", label: "进行中" },
  { status: "blocked", label: "阻塞" },
  { status: "done", label: "已完成" }
];

export function TaskBoardDialog({
  open,
  onOpenChange,
  projectId,
  sessionId,
  planText,
  onOpenSession
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  sessionId?: string;
  planText?: string;
  onOpenSession: (sessionId: string) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const tasks = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api<WorkspaceTask[]>(`/api/projects/${projectId}/tasks`),
    enabled: open && Boolean(projectId)
  });
  const create = useMutation({
    mutationFn: (input: { title: string; status?: WorkspaceTask["status"] }) =>
      api(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          status: input.status ?? "todo",
          ...(sessionId ? { sessionId } : {})
        })
      }),
    onSuccess: async () => {
      setTitle("");
      await qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    }
  });
  const update = useMutation({
    mutationFn: (task: WorkspaceTask) =>
      api(`/api/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: task.title,
          status: task.status,
          sessionId: task.sessionId,
          description: task.description ?? ""
        })
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    }
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/tasks/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    }
  });
  const fromPlan = useMutation({
    mutationFn: () =>
      api<WorkspaceTask[]>(`/api/projects/${projectId}/tasks/from-plan`, {
        method: "POST",
        body: JSON.stringify({ text: planText, sessionId })
      }),
    onSuccess: async (created: WorkspaceTask[]) => {
      await qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      toast.success(`已从计划生成 ${created.length} 个任务`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "生成任务失败")
  });
  const grouped = useMemo(() => {
    const items = tasks.data ?? [];
    return Object.fromEntries(
      COLUMNS.map((column) => [
        column.status,
        items.filter((item) => item.status === column.status)
      ])
    ) as Record<WorkspaceTask["status"], WorkspaceTask[]>;
  }, [tasks.data]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] sm:w-[min(96vw,1100px)]">
        <DialogTitle className="flex items-center gap-2">
          <CheckSquare className="size-4" /> 任务看板
        </DialogTitle>
        <DialogDescription>个人任务，可关联当前 Session；刷新后保持。</DialogDescription>
        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = title.trim();
            if (!value) return;
            create.mutate({ title: value });
          }}
        >
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="添加任务…"
            className="min-w-0 flex-1"
          />
          <Button type="submit" disabled={!title.trim() || create.isPending}>
            <Plus className="size-4" /> 添加
          </Button>
          {planText ? (
            <Button
              type="button"
              variant="outline"
              disabled={fromPlan.isPending}
              onClick={() => fromPlan.mutate()}
            >
              从计划生成
            </Button>
          ) : null}
        </form>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => (
            <section
              key={column.status}
              className="rounded-xl border border-border bg-muted/30 p-2"
            >
              <h3 className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                {column.label} · {grouped[column.status]?.length ?? 0}
              </h3>
              <div className="space-y-2">
                {(grouped[column.status] ?? []).map((task) => (
                  <article key={task.id} className="rounded-lg border border-border bg-card p-2">
                    <p className="text-sm font-medium leading-5">{task.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <select
                        className="h-7 rounded-md border bg-background px-1 text-[11px]"
                        value={task.status}
                        onChange={(event) =>
                          update.mutate({
                            ...task,
                            status: event.target.value as WorkspaceTask["status"]
                          })
                        }
                      >
                        {COLUMNS.map((item) => (
                          <option key={item.status} value={item.status}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      {task.sessionId ? (
                        <button
                          type="button"
                          className="text-[11px] text-primary"
                          onClick={() => onOpenSession(task.sessionId!)}
                        >
                          打开对话
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label="删除任务"
                        onClick={() => remove.mutate(task.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
