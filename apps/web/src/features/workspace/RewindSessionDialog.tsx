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

export type RewindMode = "fork" | "current" | "backup";
export type RewindBoundary = "turn" | "after";

export function RewindSessionDialog({
  sessionId,
  messageId,
  currentBlocked,
  nativeHistory,
  busy,
  onCancel,
  onConfirm
}: {
  sessionId: string;
  messageId: string;
  currentBlocked: boolean;
  nativeHistory: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (mode: RewindMode, boundary: RewindBoundary) => void;
}) {
  const [mode, setMode] = useState<RewindMode>("current");
  const [boundary, setBoundary] = useState<RewindBoundary>("turn");
  const message = useQuery({
    queryKey: ["rewind-message", messageId],
    queryFn: () => api<Message>(`/api/messages/${encodeURIComponent(messageId)}`),
    retry: false
  });
  const plan = useQuery({
    queryKey: ["rewind-plan", sessionId, messageId, boundary],
    queryFn: () =>
      api<{ point: Message; removedMessages: number; removedTurns: number }>(
        `/api/sessions/${sessionId}/rewind?${new URLSearchParams({ messageId, boundary })}`
      ),
    retry: false
  });
  let preview = plan.data?.point.content ?? "";
  if (plan.data?.point.role === "user") {
    try {
      preview = visibleUserMessageText(preview, JSON.parse(plan.data.point.dataJson ?? "{}"));
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
            {boundary === "after" && message.data?.role === "assistant"
              ? "保留这条回复及之前的对话，从这里继续。"
              : "撤销这一轮及之后的消息、回复和工具记录，将用户原文和附件放回输入框，供你修改后重做。"}
          </DialogDescription>
        </DialogHeader>
        {plan.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            正在加载回退位置…
          </p>
        ) : null}
        {plan.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {plan.error.message}
              <Button variant="ghost" onClick={() => void plan.refetch()}>
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {message.data?.role === "assistant" ? (
          <Select
            value={boundary}
            onValueChange={(value) => setBoundary(value as RewindBoundary)}
            disabled={busy}
          >
            <SelectTrigger aria-label="回退位置" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="turn">撤销这整轮，回到用户消息发送前</SelectItem>
                <SelectItem value="after">保留这条回复，移除后续内容</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        {plan.data ? (
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
              <SelectItem value="current" disabled={currentBlocked}>
                回退当前对话
              </SelectItem>
              <SelectItem value="backup" disabled={currentBlocked}>
                回退当前对话，并保存备份
              </SelectItem>
              <SelectItem value="fork">分叉新对话，保留原对话</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {mode === "fork"
            ? "原对话和输入草稿保留，可随时返回查看。"
            : mode === "backup"
              ? "留在当前对话继续，另存一份回退前的完整对话和输入草稿。"
              : "直接在当前对话移除后续内容，不创建备份对话。"}
        </p>
        {plan.data ? (
          <p role="status" className="text-sm">
            {plan.data.removedMessages
              ? `将撤销 ${plan.data.removedTurns} 轮，移除 ${plan.data.removedMessages} 条消息和执行记录。`
              : "这个位置之后没有可回退的消息，请选择撤销整轮。"}
          </p>
        ) : null}
        {currentBlocked ? (
          <p className="text-xs text-muted-foreground">
            当前有运行任务或待发送消息。停止任务并处理队列后，可在当前对话回退。
          </p>
        ) : null}
        <Alert>
          <AlertDescription>
            {nativeHistory
              ? "页面与下一次发送给模型的上下文会一起回退，保留此前的原生消息和工具记录。"
              : "此对话尚无可回退的 Codex 原生历史，继续时使用保留的文字快照，不包含工具输出。"}
            项目文件保持当前状态。
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button
            disabled={
              busy ||
              !plan.isSuccess ||
              (mode !== "fork" && !plan.data?.removedMessages) ||
              ((mode !== "fork" || nativeHistory) && currentBlocked)
            }
            onClick={() => onConfirm(mode, boundary)}
          >
            {busy ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <CornerUpLeft data-icon="inline-start" />
            )}
            {busy ? "正在回退…" : mode === "fork" ? "分叉并回退" : "回退当前对话"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
