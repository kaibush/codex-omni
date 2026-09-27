import { useState } from "react";
import { SessionIcon } from "@/components/SessionIcon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import type { Session } from "@/types";

export type SessionToDelete = Pick<Session, "id" | "title" | "kind" | "clientType">;

export function DeleteSessionsDialog({
  sessions,
  busy,
  onCancel,
  onConfirm
}: {
  sessions: SessionToDelete[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (purgeSource: boolean) => void;
}) {
  const [purgeSource, setPurgeSource] = useState(true);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>删除对话</DialogTitle>
          <DialogDescription>
            确定删除以下 {sessions.length} 个对话？此操作不可恢复。
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 space-y-2 overflow-y-auto text-sm">
          {sessions.map((session) => (
            <li key={session.id} className="flex min-w-0 items-center gap-2">
              <SessionIcon session={session} labelled />
              <span className="truncate" title={session.title}>
                {session.title}
              </span>
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          <label className="flex h-8 items-center gap-2 rounded-lg text-sm">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              checked={purgeSource}
              disabled={busy}
              onChange={(event) => setPurgeSource(event.target.checked)}
            />
            同时删除本地数据
          </label>
          <p className="text-xs text-muted-foreground">
            {purgeSource
              ? "同时清理客户端目录中的原始对话记录。仍被其他对话使用的数据会保留。"
              : "仅删除工作台中的对话，客户端目录中的原始数据会保留。"}
          </p>
          {sessions.some((session) => session.kind === "terminal-chat") ? (
            <p className="text-xs text-muted-foreground">关联的终端进程也会停止。</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-lg"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-8 rounded-lg"
            disabled={busy || !sessions.length}
            onClick={() => onConfirm(purgeSource)}
          >
            {busy ? "删除中" : "删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
