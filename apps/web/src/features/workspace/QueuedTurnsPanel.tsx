import {
  ChevronDown,
  ChevronUp,
  Ellipsis,
  ListPlus,
  LoaderCircle,
  Pencil,
  SendHorizontal,
  Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { QueuedTurn } from "@/types";
import { queuePreviewText, queuedAttachmentMeta } from "@/features/workspace/composer-attachments";

export function QueuedTurnsPanel({
  items,
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
  onInsert
}: {
  items: QueuedTurn[];
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
}) {
  return (
    <section className="mb-2 overflow-hidden rounded-xl border border-border bg-muted/45">
      <header className="flex min-h-9 items-center gap-2 border-b border-border px-3 text-xs">
        <ListPlus className="size-3.5 text-primary" />
        <b className="shrink-0">待发送 · {items.length}</b>
        <span className="ml-auto text-muted-foreground">
          <span className="sm:hidden">完成后自动发送</span>
          <span className="hidden sm:inline">当前任务结束后自动发送</span>
        </span>
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
                  <div className="mt-1 flex justify-end gap-3 p-1.5 sm:gap-1 sm:p-0">
                    <Button
                      type="button"
                      variant="ghost"
                      className="queue-touch-target"
                      onClick={onCancelEdit}
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      className="queue-touch-target"
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
                  <div className="ml-auto flex shrink-0 items-center gap-3 p-1.5 sm:gap-1 sm:p-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="queue-touch-target"
                      title={connected ? "立即插入当前任务" : "连接恢复后可直接插入"}
                      aria-label="直接插入队列消息"
                      disabled={!connected || Boolean(insertingId)}
                      onClick={() => onInsert(item.id)}
                    >
                      {insertingId === item.id ? (
                        <LoaderCircle data-icon="inline-start" className="animate-spin" />
                      ) : (
                        <SendHorizontal data-icon="inline-start" />
                      )}
                    </Button>
                    <div className="sm:hidden">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="queue-touch-target"
                            aria-label="队列消息更多操作"
                          >
                            <Ellipsis data-icon="inline-start" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="top">
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              className="min-h-11"
                              disabled={index === 0}
                              onSelect={() => onMove(item.id, "up")}
                            >
                              <ChevronUp data-icon="inline-start" />
                              上移
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="min-h-11"
                              disabled={index === items.length - 1}
                              onSelect={() => onMove(item.id, "down")}
                            >
                              <ChevronDown data-icon="inline-start" />
                              下移
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="min-h-11"
                              disabled={insertingId === item.id}
                              onSelect={() => onBeginEdit(item)}
                            >
                              <Pencil data-icon="inline-start" />
                              编辑消息
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="min-h-11"
                              variant="destructive"
                              disabled={insertingId === item.id}
                              onSelect={() => onRemove(item.id)}
                            >
                              <Trash2 data-icon="inline-start" />
                              删除消息
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="hidden items-center gap-1 sm:flex">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="上移队列消息"
                        title="上移队列消息"
                        disabled={index === 0}
                        onClick={() => onMove(item.id, "up")}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="下移队列消息"
                        title="下移队列消息"
                        disabled={index === items.length - 1}
                        onClick={() => onMove(item.id, "down")}
                      >
                        <ChevronDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="编辑队列消息"
                        title="编辑队列消息"
                        disabled={insertingId === item.id}
                        onClick={() => onBeginEdit(item)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="删除队列消息"
                        title="删除队列消息"
                        disabled={insertingId === item.id}
                        onClick={() => onRemove(item.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
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
