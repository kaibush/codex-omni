import { useEffect, useState } from "react";
import { ArrowRight, GitFork, MessageSquareText } from "lucide-react";
import { clientName } from "@codex-omni/protocol";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Provider, Session } from "@/types";

export function ProviderContinuationDialog({
  open,
  onOpenChange,
  source,
  target,
  onConfirm,
  busy
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  source: Session | null;
  target: Provider | null;
  onConfirm: (mode: "same-session" | "new-session") => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<"same-session" | "new-session">("same-session");
  useEffect(() => {
    if (open) setMode("same-session");
  }, [open, target?.id]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>切换客户端 / 供应商</DialogTitle>
        <DialogDescription>选择如何使用新的供应商继续当前工作。</DialogDescription>
        <div className="my-4 flex min-w-0 items-center gap-3 rounded-lg border bg-muted p-3 text-sm">
          <span className="min-w-0 flex-1 truncate">{source?.title}</span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {clientName(target?.kind)} · {target?.name}
          </span>
        </div>
        <div className="space-y-2" role="radiogroup" aria-label="继续方式">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "same-session"}
            onClick={() => setMode("same-session")}
            className={`flex w-full gap-3 rounded-lg border p-3 text-left ${mode === "same-session" ? "border-primary bg-accent" : "hover:bg-muted"}`}
          >
            <MessageSquareText className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="block text-sm font-medium">在当前对话继续</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                保留当前对话和所有消息。恢复此供应商的线程，并补入切换期间的可读上下文。
              </span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "new-session"}
            onClick={() => setMode("new-session")}
            className={`flex w-full gap-3 rounded-lg border p-3 text-left ${mode === "new-session" ? "border-primary bg-accent" : "hover:bg-muted"}`}
          >
            <GitFork className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="block text-sm font-medium">新建续接对话</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                创建独立对话，带入最近的可读上下文，保留原对话。
              </span>
            </span>
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          跨客户端会带入最近的用户与助手消息，过长内容会截断；共享项目文件，工具执行状态由各客户端分别保存。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            className="h-8 rounded-lg"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button className="h-8 rounded-lg" disabled={busy} onClick={() => onConfirm(mode)}>
            {busy ? "正在切换…" : mode === "same-session" ? "在当前对话继续" : "创建续接对话"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
