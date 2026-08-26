import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export function PromptEnhanceDialog({
  open,
  original,
  enhanced,
  busy,
  error,
  model,
  onOpenChange,
  onChangeEnhanced,
  onApply,
  onStart,
  onRetry
}: {
  open: boolean;
  original: string;
  enhanced: string;
  busy: boolean;
  error: string;
  model: string;
  onOpenChange: (open: boolean) => void;
  onChangeEnhanced: (value: string) => void;
  onApply: () => void;
  onStart: () => void;
  onRetry: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(94vw,720px)]">
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="size-4" /> 强化提示词
        </DialogTitle>
        <DialogDescription>
          用当前供应商把草稿改得更具体，方便 Codex 执行。不会发送到当前对话。
          {model ? ` 模型：${model}` : ""}
        </DialogDescription>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="field-label">
            原文
            <textarea className="field min-h-40 text-sm" value={original} readOnly />
          </label>
          <label className="field-label">
            强化结果
            <textarea
              className="field min-h-40 text-sm"
              value={enhanced}
              onChange={(event) => onChangeEnhanced(event.target.value)}
              placeholder={busy ? "正在强化…" : "强化结果会出现在这里"}
            />
          </label>
        </div>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            保留原文
          </Button>
          {enhanced || error || busy ? (
            <Button type="button" variant="outline" onClick={onRetry} disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              重新强化
            </Button>
          ) : null}
          {!enhanced && !busy ? (
            <Button type="button" onClick={onStart} disabled={!original.trim()}>
              <Sparkles className="size-4" />
              开始强化
            </Button>
          ) : null}
          <Button type="button" onClick={onApply} disabled={busy || !enhanced.trim()}>
            使用强化结果
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
