import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookText, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { PromptTemplate } from "@/types";
import { normalizeTemplateCommand, templateInsertText } from "./prompt-templates";

export function PromptTemplatePicker({
  onInsert,
  disabled = false
}: {
  onInsert: (text: string) => void;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [manageOpen, setManageOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [content, setContent] = useState("");
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<PromptTemplate[]>("/api/templates")
  });
  const items = templates.data ?? [];

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setCommand("");
    setContent("");
  };

  const saveTemplate = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        command: normalizeTemplateCommand(command) ?? "",
        content: content.trim()
      };
      return editingId
        ? api(`/api/templates/${editingId}`, { method: "PUT", body: JSON.stringify(payload) })
        : api("/api/templates", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: async () => {
      const wasEdit = Boolean(editingId);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success(wasEdit ? "已更新提示词" : "已保存提示词");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存提示词失败")
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: string) => api(`/api/templates/${id}`, { method: "DELETE" }),
    onSuccess: async (_, id) => {
      if (editingId === id) resetForm();
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("已删除提示词");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "删除提示词失败")
  });

  const beginEdit = (template: PromptTemplate) => {
    setEditingId(template.id);
    setName(template.name);
    setCommand(template.command ?? "");
    setContent(template.content);
    setManageOpen(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 rounded-lg"
            aria-label="插入提示词或命令"
            title="插入提示词或命令"
            disabled={disabled}
          >
            <BookText className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {items.length ? (
            items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onSelect={() => onInsert(templateInsertText(item))}
              >
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.command ? (
                  <span className="font-mono text-[10px] text-muted-foreground">{item.command}</span>
                ) : null}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>还没有提示词</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              resetForm();
              setManageOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            管理提示词
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={manageOpen}
        onOpenChange={(open) => {
          setManageOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>提示词与命令</DialogTitle>
            <DialogDescription>保存后可插入对话或终端输入框，也可用斜杠命令展开。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {items.length ? (
              items.map((item) => (
                <div key={item.id} className="flex items-start gap-2 rounded-lg border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{item.name}</span>
                      {item.command ? (
                        <span className="font-mono text-[10px] text-muted-foreground">{item.command}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.content}</p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 rounded-lg"
                    aria-label={`编辑 ${item.name}`}
                    onClick={() => beginEdit(item)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 rounded-lg"
                    aria-label={`删除 ${item.name}`}
                    onClick={() => deleteTemplate.mutate(item.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">还没有提示词，先在下方新增一条。</p>
            )}
          </div>
          <div className="grid gap-2 rounded-lg border bg-muted/40 p-3">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="名称，例如代码审查"
              aria-label="提示词名称"
            />
            <Input
              className="font-mono"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="斜杠命令，例如 /review"
              aria-label="斜杠命令"
            />
            <Textarea
              className="min-h-24"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="插入到输入框的内容"
              aria-label="提示词内容"
            />
          </div>
          <DialogFooter>
            {editingId ? (
              <Button type="button" variant="outline" className="h-8 rounded-lg" onClick={resetForm}>
                取消编辑
              </Button>
            ) : null}
            <Button
              type="button"
              className="h-8 rounded-lg"
              disabled={!name.trim() || !content.trim() || saveTemplate.isPending}
              onClick={() => saveTemplate.mutate()}
            >
              <Plus className="size-4" />
              {editingId ? "更新提示词" : "保存提示词"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
