import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileCode2,
  GitCommit,
  GitBranch,
  MessageSquareText,
  Search,
  Settings,
  Folder
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  filterPaletteItems,
  groupPaletteItems,
  itemMatchesScope,
  nextPaletteScope,
  PALETTE_COMMANDS,
  PALETTE_GROUP_LABEL,
  PALETTE_SCOPES,
  paletteScopeLabel,
  searchScopeFor,
  type PaletteAction,
  type PaletteGroup,
  type PaletteItem,
  type PaletteScope
} from "./command-palette";

const SESSION_STATUS_FILTERS = [
  { id: "", label: "全部状态" },
  { id: "running", label: "进行中" },
  { id: "idle", label: "空闲" },
  { id: "failed", label: "异常" },
  { id: "cancelled", label: "已取消" },
  { id: "interrupted", label: "已中断" }
] as const;

type SearchHit = {
  type: "project" | "session" | "message" | "file" | "branch" | "commit";
  id: string;
  title: string;
  subtitle?: string | undefined;
  snippet?: string | undefined;
  projectId?: string | undefined;
  sessionId?: string | undefined;
  messageId?: string | undefined;
  path?: string | undefined;
  line?: number | null | undefined;
  hash?: string | undefined;
};

const GROUP_ICON: Record<PaletteGroup, typeof Search> = {
  command: Settings,
  session: MessageSquareText,
  message: MessageSquareText,
  file: FileCode2,
  git: GitCommit,
  project: Folder
};

function hitsToItems(hits: SearchHit[]): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const hit of hits) {
    if (hit.type === "project" && hit.projectId) {
      items.push({
        id: hit.id,
        group: "project",
        title: hit.title,
        subtitle: hit.subtitle,
        keywords: [hit.title, hit.subtitle ?? ""],
        action: { type: "project", projectId: hit.projectId }
      });
      continue;
    }
    if (hit.type === "session" && hit.projectId && hit.sessionId) {
      items.push({
        id: hit.id,
        group: "session",
        title: hit.title,
        subtitle: hit.subtitle,
        snippet: hit.snippet,
        keywords: [hit.title, hit.subtitle ?? "", hit.snippet ?? ""],
        action: { type: "session", projectId: hit.projectId, sessionId: hit.sessionId }
      });
      continue;
    }
    if (hit.type === "message" && hit.projectId && hit.sessionId && hit.messageId) {
      items.push({
        id: hit.id,
        group: "message",
        title: hit.title,
        subtitle: hit.subtitle,
        snippet: hit.snippet,
        keywords: [hit.title, hit.snippet ?? ""],
        action: {
          type: "message",
          projectId: hit.projectId,
          sessionId: hit.sessionId,
          messageId: hit.messageId
        }
      });
      continue;
    }
    if (hit.type === "file" && hit.projectId && hit.path) {
      items.push({
        id: hit.id,
        group: "file",
        title: hit.title,
        subtitle: hit.subtitle,
        snippet: hit.snippet,
        keywords: [hit.path],
        action: {
          type: "file",
          projectId: hit.projectId,
          path: hit.path,
          line: hit.line ?? null
        }
      });
      continue;
    }
    if (hit.type === "commit" && hit.projectId && hit.hash) {
      items.push({
        id: hit.id,
        group: "git",
        title: hit.title,
        subtitle: hit.subtitle,
        keywords: [hit.hash, hit.title],
        action: { type: "git-commit", projectId: hit.projectId, hash: hit.hash }
      });
      continue;
    }
    if (hit.type === "branch" && hit.projectId) {
      items.push({
        id: hit.id,
        group: "git",
        title: hit.title,
        subtitle: hit.subtitle,
        keywords: [hit.title],
        action: { type: "git-branch", projectId: hit.projectId, name: hit.title }
      });
    }
  }
  return items;
}

export function CommandPalette({
  open,
  onOpenChange,
  projectId,
  initialScope = "all",
  onRun
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | undefined;
  initialScope?: PaletteScope;
  onRun: (action: PaletteAction) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<PaletteScope>(initialScope);
  const [sessionStatus, setSessionStatus] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setActiveIndex(0);
    setScope(initialScope);
    setSessionStatus("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open, initialScope]);

  useEffect(() => {
    const trimmed = query.trim();
    const remoteScope = searchScopeFor(scope);
    if (!open || !trimmed || !remoteScope) {
      setHits([]);
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ q: trimmed, scope: remoteScope });
      if (projectId) params.set("projectId", projectId);
      if (remoteScope === "session" && sessionStatus) params.set("status", sessionStatus);
      void api<{ hits: SearchHit[] }>(`/api/search?${params}`)
        .then((result) => setHits(result.hits))
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, projectId, query, scope, sessionStatus]);

  const items = useMemo(() => {
    const commands = filterPaletteItems(PALETTE_COMMANDS, query).filter((item) =>
      itemMatchesScope(item, scope)
    );
    const remote = hitsToItems(hits).filter((item) => itemMatchesScope(item, scope));
    if (!query.trim()) return commands;
    return scope === "command" ? commands : [...commands, ...remote];
  }, [hits, query, scope]);
  const groups = useMemo(() => groupPaletteItems(items), [items]);
  const flat = items;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, hits, scope]);

  useEffect(() => {
    const active = listRef.current?.querySelector("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.action.type === "message") {
      const hits = items
        .map((entry) => entry.action)
        .filter(
          (action): action is Extract<PaletteAction, { type: "message" }> =>
            action.type === "message"
        )
        .map((action) => ({
          projectId: action.projectId,
          sessionId: action.sessionId,
          messageId: action.messageId
        }));
      onRun({ ...item.action, hits });
    } else {
      onRun(item.action);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="command-palette-dialog top-[10%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onKeyDownCapture={(event) => {
          if (event.key !== "Tab") return;
          event.preventDefault();
          event.stopPropagation();
          setScope((current) => nextPaletteScope(current, event.shiftKey ? -1 : 1));
          inputRef.current?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, Math.max(flat.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            run(flat[activeIndex]);
          }
        }}
      >
        <DialogTitle className="sr-only">搜索</DialogTitle>
        <DialogDescription className="sr-only">
          按全部、命令、工程、会话、消息、文件或 Git 搜索
        </DialogDescription>
        <div className="flex items-center gap-2 px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              scope === "all"
                ? "搜索命令、会话、消息、文件、提交…"
                : `搜索${paletteScopeLabel(scope)}`
            }
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {loading ? <span className="text-[10px] text-muted-foreground">搜索中</span> : null}
          <kbd className="command-kbd">ESC</kbd>
        </div>
        <div className="command-palette-tabs" role="tablist" aria-label="搜索范围">
          {PALETTE_SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={scope === item.id}
              className={`command-palette-tab ${scope === item.id ? "is-active" : ""}`}
              onClick={() => {
                setScope(item.id);
                inputRef.current?.focus();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {scope === "session" ? (
          <div className="command-palette-tabs" role="tablist" aria-label="会话状态">
            {SESSION_STATUS_FILTERS.map((item) => (
              <button
                key={item.id || "all"}
                type="button"
                className={`command-palette-tab ${sessionStatus === item.id ? "is-active" : ""}`}
                onClick={() => {
                  setSessionStatus(item.id);
                  inputRef.current?.focus();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        <div ref={listRef} className="command-palette-list">
          {groups.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              {query.trim()
                ? "没有匹配的结果"
                : scope === "all" || scope === "command"
                  ? "输入关键字搜索，或用 Tab 切换分类"
                  : `输入关键字搜索${paletteScopeLabel(scope)}`}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.group} className="py-1">
                <h3 className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {PALETTE_GROUP_LABEL[group.group]}
                </h3>
                {group.items.map((item) => {
                  const index = flat.findIndex((entry) => entry.id === item.id);
                  const Icon =
                    item.action.type === "git-branch" ? GitBranch : GROUP_ICON[item.group];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-active={index === activeIndex}
                      className={cn("command-palette-item", index === activeIndex && "is-active")}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => run(item)}
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-sm">{item.title}</span>
                        {item.subtitle ? (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {item.subtitle}
                          </span>
                        ) : null}
                        {item.snippet ? (
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {item.snippet}
                          </span>
                        ) : null}
                      </span>
                      {item.shortcut ? <kbd className="command-kbd">{item.shortcut}</kbd> : null}
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>Tab 切换分类</span>
          <span>Enter 打开 · Esc 关闭</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
