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
        <DialogTitle>切换供应商</DialogTitle>
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
                延续当前客户端的原生会话，保留已有消息与工具上下文。
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
          当前对话使用 {clientName(source?.clientType)}，只能切换同一客户端的供应商。
          新建续接对话会带入最近的文字上下文，过长内容会截断。
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
