import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import type { ProjectNote } from "@/types";

const KINDS: Array<{ value: ProjectNote["kind"]; label: string }> = [
  { value: "rule", label: "规则" },
  { value: "command", label: "常用命令" },
  { value: "env", label: "环境说明" },
  { value: "note", label: "笔记" }
];

export function ProjectKnowledgeDialog({
  open,
  onOpenChange,
  projectId
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<ProjectNote["kind"]>("rule");
  const [agents, setAgents] = useState("");
  const [revision, setRevision] = useState("");
  const notes = useQuery({
    queryKey: ["notes", projectId],
    queryFn: () => api<ProjectNote[]>(`/api/projects/${projectId}/notes`),
    enabled: open && Boolean(projectId)
  });
  const agentsFile = useQuery({
    queryKey: ["agents-md", projectId],
    queryFn: () =>
      api<{ content: string; revision: string; exists: boolean }>(
        `/api/projects/${projectId}/agents-md`
      ),
    enabled: open && Boolean(projectId)
  });
  useEffect(() => {
    if (!agentsFile.data) return;
    setAgents(agentsFile.data.content);
    setRevision(agentsFile.data.revision);
  }, [agentsFile.data]);
  const saveNote = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/notes`, {
        method: "POST",
        body: JSON.stringify({ title, content, kind })
      }),
    onSuccess: async () => {
      setTitle("");
      setContent("");
      await qc.invalidateQueries({ queryKey: ["notes", projectId] });
      toast.success("已保存项目规则");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存失败")
  });
  const toggleNote = useMutation({
    mutationFn: (note: ProjectNote) =>
      api(`/api/notes/${note.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: note.title,
          content: note.content,
          kind: note.kind,
          enabled: !note.enabled
        })
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", projectId] })
  });
  const removeNote = useMutation({
    mutationFn: (id: string) => api(`/api/notes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", projectId] })
  });
  const saveAgents = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/agents-md`, {
        method: "PUT",
        body: JSON.stringify({ content: agents, revision })
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["agents-md", projectId] });
      toast.success("已保存 AGENTS.md");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存 AGENTS.md 失败")
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] sm:w-[min(92vw,760px)]">
        <DialogTitle className="flex items-center gap-2">
          <BookOpen className="size-4" /> 项目规则
        </DialogTitle>
        <DialogDescription>
          启用的规则会在发送时注入当前 turn；AGENTS.md 仍由 Codex 自动读取。
        </DialogDescription>
        <section className="mt-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            AGENTS.md
          </h3>
          <textarea
            className="field min-h-32 font-mono text-xs"
            value={agents}
            onChange={(event) => setAgents(event.target.value)}
            placeholder="项目级 Codex 规则"
          />
          <Button
            type="button"
            variant="outline"
            disabled={saveAgents.isPending}
            onClick={() => saveAgents.mutate()}
          >
            保存 AGENTS.md
          </Button>
        </section>
        <section className="mt-5 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            可引用笔记
          </h3>
          {(notes.data ?? []).map((note) => (
            <div key={note.id} className="flex items-start gap-2 rounded-xl border bg-card p-3">
              <Switch
                checked={note.enabled}
                onCheckedChange={() => toggleNote.mutate(note)}
                aria-label={`启用 ${note.title}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {note.title}
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    {KINDS.find((item) => item.value === note.kind)?.label}
                  </span>
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{note.content}</p>
              </div>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`删除 ${note.title}`}
                onClick={() => removeNote.mutate(note.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <div className="rounded-xl border bg-muted/40 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="field-label">
                标题
                <input
                  className="field"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="测试约定"
                />
              </label>
              <label className="field-label">
                类型
                <select
                  className="field"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as ProjectNote["kind"])}
                >
                  {KINDS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field-label mt-2">
              内容
              <textarea
                className="field min-h-20"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="发送时注入的规则"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              disabled={!title.trim() || !content.trim() || saveNote.isPending}
              onClick={() => saveNote.mutate()}
            >
              <Plus className="size-4" /> 保存规则
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
