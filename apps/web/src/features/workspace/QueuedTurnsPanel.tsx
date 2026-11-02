import {
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  ListPlus,
  Pencil,
  Play,
  Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { QueuedTurn } from "@/types";
import { queuePreviewText, queuedAttachmentMeta } from "@/features/workspace/composer-attachments";

export function QueuedTurnsPanel({
  items,
  running,
  connected,
  insertingId,
  editingId,
  editValue,
  onEditValue,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onRemove,
  onMove,
  onInsert,
  onStartNext
}: {
  items: QueuedTurn[];
  running: boolean;
  connected: boolean;
  insertingId: string;
  editingId: string;
  editValue: string;
  onEditValue: (value: string) => void;
  onBeginEdit: (item: QueuedTurn) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, message: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onInsert: (id: string) => void;
  onStartNext: () => void;
}) {
  return (
    <section className="mb-2 overflow-hidden rounded-xl border border-border bg-muted/45">
      <header className="flex min-h-9 items-center gap-2 border-b border-border px-3 text-xs">
        <ListPlus className="size-3.5 text-primary" />
        <b>待发送 · {items.length}</b>
        {!running && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-xs"
            onClick={onStartNext}
          >
            <Play className="size-3.5" /> 继续下一条
          </Button>
        )}
      </header>
      <div className="max-h-48 overflow-y-auto">
        {items.map((item, index) => {
          const attachments = queuedAttachmentMeta(item.options);
          return (
            <div
              key={item.id}
              className="flex min-h-10 items-start gap-2 border-b border-border/60 px-3 py-2 last:border-b-0"
            >
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-background text-[10px] font-semibold text-muted-foreground">
                {index + 1}
              </span>
              {editingId === item.id ? (
                <div className="min-w-0 flex-1">
                  <Textarea
                    value={editValue}
                    onChange={(event) => onEditValue(event.target.value)}
                    rows={2}
                    autoFocus
                    className="min-h-14 resize-none bg-background text-sm"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") onCancelEdit();
                      if (event.key === "Enter" && (event.ctrlKey || event.metaKey))
                        onSaveEdit(item.id, editValue);
                    }}
                  />
                  <div className="mt-1 flex justify-end gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={onCancelEdit}
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7"
                      disabled={!editValue.trim()}
                      onClick={() => onSaveEdit(item.id, editValue)}
                    >
                      保存
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
                      {queuePreviewText(item)}
                    </p>
                    {attachments.length > 0 && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        附件 {attachments.map((file) => file.name).join("、")}
                      </p>
                    )}
                  </div>
                  <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      title={connected ? "跳过排队，直接插入当前对话" : "连接恢复后可直接插入"}
                      aria-label="直接插入队列消息"
                      disabled={!connected || Boolean(insertingId)}
                      onClick={() => onInsert(item.id)}
                    >
                      <CornerDownLeft data-icon="inline-start" />
                      {insertingId === item.id ? "正在插入" : "直接插入"}
                    </Button>
                    <button
                      type="button"
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                      aria-label="上移队列消息"
                      disabled={index === 0}
                      onClick={() => onMove(item.id, "up")}
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                      aria-label="下移队列消息"
                      disabled={index === items.length - 1}
                      onClick={() => onMove(item.id, "down")}
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="编辑队列消息"
                      disabled={insertingId === item.id}
                      onClick={() => onBeginEdit(item)}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="删除队列消息"
                      disabled={insertingId === item.id}
                      onClick={() => onRemove(item.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
