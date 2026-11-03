import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CornerUpLeft, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { api } from "@/lib/api";
import type { Message } from "@/types";
import { visibleUserMessageText } from "./composer-attachments";

export type RewindMode = "fork" | "current";

export function RewindSessionDialog({
  messageId,
  currentBlocked,
  busy,
  onCancel,
  onConfirm
}: {
  messageId: string;
  currentBlocked: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (mode: RewindMode) => void;
}) {
  const [mode, setMode] = useState<RewindMode>("fork");
  const message = useQuery({
    queryKey: ["rewind-message", messageId],
    queryFn: () => api<Message>(`/api/messages/${encodeURIComponent(messageId)}`),
    retry: false
  });
  let preview = message.data?.content ?? "";
  if (message.data?.role === "user") {
    try {
      preview = visibleUserMessageText(preview, JSON.parse(message.data.dataJson ?? "{}"));
    } catch {
      /* Show the original message when old attachment metadata is invalid. */
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>回退对话</DialogTitle>
          <DialogDescription>
            {message.data?.role === "assistant"
              ? "保留这条回复及之前的对话，从这里继续。"
              : "回到这条消息发送前，并将原文和附件放回输入框，供你修改后重做。"}
          </DialogDescription>
        </DialogHeader>
        {message.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            正在加载回退位置…
          </p>
        ) : null}
        {message.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              无法加载这条消息。
              <Button variant="ghost" onClick={() => void message.refetch()}>
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {message.data ? (
          <blockquote className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted p-3 text-sm">
            {preview.slice(0, 2000)}
            {preview.length > 2000 ? "…" : ""}
          </blockquote>
        ) : null}
        <Select
          value={mode}
          onValueChange={(value) => setMode(value as RewindMode)}
          disabled={busy}
        >
          <SelectTrigger aria-label="回退方式" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="fork">分叉新对话，保留原对话</SelectItem>
              <SelectItem value="current" disabled={currentBlocked}>
                回退当前对话，自动保存备份
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {mode === "fork"
            ? "原对话和输入草稿保留，可随时返回查看。"
            : "后续消息和原来的输入草稿会保存在「回退前备份」对话中。"}
        </p>
        {currentBlocked ? (
          <p className="text-xs text-muted-foreground">
            当前有运行任务或待发送消息。停止任务并处理队列后，可在当前对话回退。
          </p>
        ) : null}
        <Alert>
          <AlertDescription>
            仅回退对话，项目文件保持当前状态。继续时沿用分叉的历史快照，长对话仅携带最近的用户消息和回复，不包含工具输出。
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button
            disabled={busy || !message.isSuccess || (mode === "current" && currentBlocked)}
            onClick={() => onConfirm(mode)}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <CornerUpLeft />}
            {busy ? "正在回退…" : mode === "fork" ? "分叉并回退" : "备份并回退"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
