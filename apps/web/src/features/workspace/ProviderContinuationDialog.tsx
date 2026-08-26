import { ArrowRight, GitFork } from "lucide-react";
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
  onOpenChange: (v: boolean) => void;
  source: Session | null;
  target: Provider | null;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-2">
          <GitFork className="size-5" />
          使用其他 Provider 继续
        </DialogTitle>
        <DialogDescription>
          来源会话保持不变，系统创建新的 Provider Session，并带入可移植的对话上下文。
        </DialogDescription>
        <div className="my-4 grid grid-cols-1 items-center gap-2 sm:my-6 sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
          <div className="min-w-0 rounded-xl border bg-muted p-3 sm:p-4">
            <p className="text-xs text-muted-foreground">来源 Session</p>
            <p className="mt-1 truncate font-medium">{source?.title}</p>
          </div>
          <ArrowRight className="mx-auto size-5 rotate-90 text-muted-foreground sm:rotate-0" />
          <div className="min-w-0 rounded-xl border border-blue-200 bg-accent p-3 sm:p-4">
            <p className="text-xs text-primary">目标 Provider</p>
            <p className="mt-1 truncate font-medium">{target?.name}</p>
          </div>
        </div>
        <div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          命令输出、私有工具状态等不可移植内容保留在来源 Session；用户与助手的可读消息会进入新
          Session 的上下文。
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            创建续接 Session
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
