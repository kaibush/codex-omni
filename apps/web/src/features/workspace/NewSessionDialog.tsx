import { useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, MessageSquareText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { listHistoricalSessions, sortSessionsByLatest } from "@/lib/session-title";
import type { Session } from "@/types";

const formatSessionTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}分钟前`;
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))}小时前`;
  return new Date(timestamp).toLocaleDateString();
};

export function NewSessionDialog({
  open,
  onOpenChange,
  sessions,
  providerNames,
  busy,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: Session[];
  providerNames: Map<string, string>;
  busy: boolean;
  onConfirm: (sourceId: string | null) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const history = useMemo(() => sortSessionsByLatest(listHistoricalSessions(sessions)), [sessions]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return history;
    return history.filter((session) => {
      const provider = session.providerId ? (providerNames.get(session.providerId) ?? "") : "";
      return `${session.title} ${provider}`.toLowerCase().includes(keyword);
    });
  }, [history, providerNames, query]);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setQuery("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-2">
          <MessageSquarePlus className="size-5" />
          新建对话
        </DialogTitle>
        <DialogDescription>选择本项目里的一段历史对话带入上下文，或从空白开始。</DialogDescription>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-9 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none transition focus:border-blue-200 focus:ring-4 focus:ring-blue-100/60"
            placeholder="搜索历史对话"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="mt-3 max-h-[min(50dvh,22rem)] space-y-2 overflow-y-auto pr-1">
          <button
            type="button"
            aria-pressed={selectedId === null}
            onClick={() => setSelectedId(null)}
            className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${
              selectedId === null
                ? "border-blue-200 bg-accent"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-card text-muted-foreground shadow-sm">
              <MessageSquarePlus className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">全新对话</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                不带入任何历史上下文
              </span>
            </span>
          </button>
          {filtered.map((session) => (
            <button
              key={session.id}
              type="button"
              aria-pressed={selectedId === session.id}
              onClick={() => setSelectedId(session.id)}
              className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${
                selectedId === session.id
                  ? "border-blue-200 bg-accent"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-card text-primary shadow-sm">
                <MessageSquareText className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{session.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {[
                    session.providerId ? providerNames.get(session.providerId) : null,
                    formatSessionTime(session.updatedAt)
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
          ))}
          {!filtered.length && (
            <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
              没有匹配的历史对话
            </div>
          )}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => onConfirm(selectedId)}>
            {selectedId ? "带入上下文并开始" : "开始全新对话"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
