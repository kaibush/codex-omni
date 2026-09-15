import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
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
import type { TerminalProfile } from "@/types";
import { terminalProfileCommandLabel } from "./terminal-profiles";

export { defaultTerminalProfileId, terminalProfileCommandLabel } from "./terminal-profiles";

function useTerminalProfiles() {
  return useQuery({
    queryKey: ["terminal-profiles"],
    queryFn: () => api<{ profiles: TerminalProfile[] }>("/api/terminal-profiles")
  });
}

export function TerminalProfilePicker({
  onCreate,
  creating = false,
  onManage
}: {
  onCreate: (profileId: string) => void;
  creating?: boolean;
  onManage: () => void;
}) {
  const profiles = useTerminalProfiles();
  const items = profiles.data?.profiles ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-8 rounded-lg px-2.5 text-[11px]"
          aria-label="新建终端对话"
          disabled={creating}
        >
          新建
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {items.length ? (
          items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              disabled={creating}
              title={terminalProfileCommandLabel(item.command)}
              onSelect={() => onCreate(item.id)}
            >
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>还没有启动命令</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onManage}>
          <Settings2 className="size-3.5" />
          管理启动命令
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TerminalProfileManager({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const profiles = useTerminalProfiles();
  const items = profiles.data?.profiles ?? [];

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setCommand("");
  };

  const saveProfile = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), command };
      return editingId
        ? api(`/api/terminal-profiles/${editingId}`, { method: "PUT", body: JSON.stringify(payload) })
        : api("/api/terminal-profiles", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: async () => {
      const wasEdit = Boolean(editingId);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["terminal-profiles"] });
      toast.success(wasEdit ? "已更新启动命令" : "已保存启动命令");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存启动命令失败")
  });

  const deleteProfile = useMutation({
    mutationFn: (id: string) => api(`/api/terminal-profiles/${id}`, { method: "DELETE" }),
    onSuccess: async (_, id) => {
      if (editingId === id) resetForm();
      await queryClient.invalidateQueries({ queryKey: ["terminal-profiles"] });
      toast.success("已删除启动命令");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "删除启动命令失败")
  });

  const beginEdit = (profile: TerminalProfile) => {
    setEditingId(profile.id);
    setName(profile.name);
    setCommand(profile.command);
  };

  const confirmDelete = (profile: TerminalProfile) => {
    if (!window.confirm(`删除启动命令「${profile.name}」？已有终端会话会继续使用当时保存的命令。`)) return;
    deleteProfile.mutate(profile.id);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>终端启动命令</DialogTitle>
          <DialogDescription>
            命令会通过登录 Shell 执行，可写环境变量和参数。留空则启动普通 Shell。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {items.length ? (
            items.map((item) => (
              <div key={item.id} className="flex items-start gap-2 rounded-lg border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="mt-1 line-clamp-2 font-mono text-[11px] text-muted-foreground">
                    {terminalProfileCommandLabel(item.command)}
                  </p>
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
                  onClick={() => confirmDelete(item)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">还没有启动命令，先在下方新增一条。</p>
          )}
        </div>
        <div className="grid gap-2 rounded-lg border bg-muted/40 p-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="名称，例如 Claude Code"
            aria-label="启动命令名称"
          />
          <Textarea
            className="min-h-24 font-mono text-xs"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="IS_SANDBOX=1 claude --dangerously-skip-permissions --settings ~/.claude/settings.grok.json"
            aria-label="启动命令"
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
            disabled={!name.trim() || saveProfile.isPending}
            onClick={() => saveProfile.mutate()}
          >
            <Plus className="size-4" />
            {editingId ? "更新命令" : "保存命令"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
