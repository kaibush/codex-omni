import type { Dispatch, SetStateAction } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Download,
  Eraser,
  Files,
  GitCompare,
  GitFork,
  LoaderCircle,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  TerminalSquare,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeSwitch } from "@/components/theme-switch";
import { api } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { formatCompactDateTime, formatDateTime } from "@/lib/utils";
import { taskStatusLabel } from "@/lib/task-state";
import type { Project, Provider, Session, SessionCheckpoint } from "@/types";
import { LiveDuration } from "./WorkspaceStatus";
import type { RunState, WorkspaceView } from "./workspace-model";

export function WorkspaceHeader({
  sidebar,
  isMobile,
  setSidebar,
  activeProject,
  activeSession,
  renamingSessionId,
  setRenamingSessionId,
  renameDraft,
  setRenameDraft,
  saveSessionTitle,
  beginRenameSession,
  runState,
  selectedProvider,
  runtimeCodexHome,
  runElapsed,
  runFirstResponse,
  runTokenLabel,
  workspaceView,
  changeWorkspaceView,
  dirtyCount,
  gitCount,
  forkSessionFrom,
  reloadSession,
  clearRunRecords,
  updateSession,
  archiveSession,
  exportSession,
  deleteSession,
  setSendNotice
}: {
  sidebar: boolean;
  isMobile: boolean;
  setSidebar: Dispatch<SetStateAction<boolean>>;
  activeProject: Project;
  activeSession: Session | undefined;
  renamingSessionId: string;
  setRenamingSessionId: Dispatch<SetStateAction<string>>;
  renameDraft: string;
  setRenameDraft: Dispatch<SetStateAction<string>>;
  saveSessionTitle: (id: string) => void;
  beginRenameSession: (session: Session) => void;
  runState: RunState | null;
  selectedProvider: Provider | undefined;
  runtimeCodexHome: string | undefined;
  runElapsed: string;
  runFirstResponse: string;
  runTokenLabel: string | null;
  workspaceView: WorkspaceView;
  changeWorkspaceView: (view: WorkspaceView) => void;
  dirtyCount: number;
  gitCount: number;
  forkSessionFrom: (messageId?: string, sourceId?: string) => void;
  reloadSession: () => void;
  clearRunRecords: () => void;
  updateSession: {
    mutate: (input: {
      id: string;
      changes: {
        title?: string;
        pinned?: boolean;
        archived?: boolean;
        color?: string | null;
        icon?: string | null;
        tags?: string[];
      };
    }) => void;
  };
  archiveSession: (session: Session, archived: boolean) => void;
  exportSession: (id: string, format: "markdown" | "json") => void;
  deleteSession: { mutate: (id: string) => void };
  setSendNotice: (value: string) => void;
}) {
  return (
    <header className="workspace-header flex shrink-0 items-center gap-3 px-3 sm:px-5">
      {(!sidebar || isMobile) && (
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          aria-label="打开项目侧栏"
          onClick={() => setSidebar(true)}
        >
          <Menu className="size-4" />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
          {activeSession ? (
            <>
              {renamingSessionId === activeSession.id ? (
                <Input
                  autoFocus
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => saveSessionTitle(activeSession.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveSessionTitle(activeSession.id);
                    if (event.key === "Escape") {
                      setRenamingSessionId("");
                      setRenameDraft("");
                    }
                  }}
                  className="h-7 min-w-0 max-w-md px-2 text-sm"
                  aria-label="编辑 Session 标题"
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 truncate text-left hover:text-primary"
                  onDoubleClick={() => beginRenameSession(activeSession)}
                  title="双击重命名"
                >
                  {activeSession.title}
                </button>
              )}
              {runState && (
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    runState.reconnecting
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : runState.status === "running"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : runState.status === "completed"
                          ? "bg-muted text-muted-foreground"
                          : runState.status === "cancelled"
                            ? "bg-muted text-muted-foreground"
                            : runState.status === "interrupted"
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {runState.status === "running" && (
                    <LoaderCircle className="size-3 animate-spin" />
                  )}
                  {runState.reconnecting
                    ? `重连中 ${runState.reconnecting.attempt}/${runState.reconnecting.maxAttempts}`
                    : taskStatusLabel(runState.status)}
                </span>
              )}
            </>
          ) : (
            <span className="min-w-0 truncate">{activeProject.name}</span>
          )}
        </h1>
        <p
          className="mt-0.5 hidden truncate text-[11px] leading-4 text-muted-foreground sm:block"
          title={[
            activeProject.displayPath,
            activeSession?.createdAt ? `会话 ${formatDateTime(activeSession.createdAt)}` : "",
            selectedProvider?.codexHome
              ? `CODEX_HOME ${selectedProvider.codexHome}`
              : runtimeCodexHome
                ? `CODEX_HOME ${runtimeCodexHome}`
                : ""
          ]
            .filter(Boolean)
            .join("\n")}
        >
          {[
            activeProject.displayPath,
            activeSession?.createdAt
              ? `会话 ${formatCompactDateTime(activeSession.createdAt)}`
              : "",
            runState && runState.status !== "running" && runElapsed ? `耗时 ${runElapsed}` : "",
            runFirstResponse ? `首响 ${runFirstResponse}` : "",
            runTokenLabel ? `tokens ${runTokenLabel}` : "",
            selectedProvider?.codexHome ?? runtimeCodexHome
          ]
            .filter(Boolean)
            .join(" · ")}
          {runState?.status === "running" ? (
            <>
              {" · 耗时 "}
              <LiveDuration startedAt={runState.startedAt} />
            </>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Tabs
          value={workspaceView}
          onValueChange={(value) => changeWorkspaceView(value as WorkspaceView)}
        >
          <TabsList>
            <TabsTrigger value="chat" className="px-2.5 text-xs sm:px-3">
              <MessageSquareText />
              <span className="hidden sm:inline">对话</span>
            </TabsTrigger>
            <TabsTrigger value="files" className="px-2.5 text-xs sm:px-3">
              <Files />
              <span className="hidden sm:inline">{dirtyCount ? `文件 ${dirtyCount}` : "文件"}</span>
            </TabsTrigger>
            <TabsTrigger value="git" className="px-2.5 text-xs sm:px-3">
              <GitCompare />
              <span className="hidden sm:inline">{gitCount ? `Git ${gitCount}` : "Git"}</span>
            </TabsTrigger>
            <TabsTrigger value="terminal" className="px-2.5 text-xs sm:px-3">
              <TerminalSquare />
              <span className="hidden sm:inline">终端</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {activeSession ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label="Session 更多操作"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => beginRenameSession(activeSession)}>
                <Pencil /> 重命名
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void forkSessionFrom()}>
                <GitFork /> 从此处分叉
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={reloadSession}>
                <RefreshCw /> 重新加载
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void clearRunRecords()}>
                <Eraser /> 清理运行记录
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  updateSession.mutate({
                    id: activeSession.id,
                    changes: { pinned: !activeSession.pinnedAt }
                  })
                }
              >
                {activeSession.pinnedAt ? <PinOff /> : <Pin />}
                {activeSession.pinnedAt ? "取消置顶" : "置顶"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => archiveSession(activeSession, !activeSession.archivedAt)}
              >
                {activeSession.archivedAt ? <ArchiveRestore /> : <Archive />}
                {activeSession.archivedAt ? "恢复归档" : "归档"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => exportSession(activeSession.id, "markdown")}>
                <Download /> 导出 Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportSession(activeSession.id, "json")}>
                <Download /> 导出 JSON
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void (async () => {
                    try {
                      const items = await api<SessionCheckpoint[]>(
                        `/api/sessions/${activeSession.id}/checkpoints`
                      );
                      if (!items.length) {
                        toast.message("还没有检查点");
                        return;
                      }
                      const latest = items[0]!;
                      const files = latest.files.slice(0, 8).join("、") || "无文件变更";
                      if (
                        !window.confirm(
                          `恢复到「${latest.title}」？\nHEAD ${latest.gitHead?.slice(0, 7) ?? "-"}\n${files}\n当前未提交变更会先被 stash。`
                        )
                      )
                        return;
                      await api(`/api/checkpoints/${latest.id}/restore`, {
                        method: "POST"
                      });
                      toast.success("已恢复到 turn 前检查点");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "恢复失败");
                    }
                  })();
                }}
              >
                恢复最近检查点
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void copyTextToClipboard(activeSession.id).then((copied) =>
                    setSendNotice(copied ? "已复制 Session ID" : "复制失败，请手动选择")
                  );
                }}
              >
                <Copy /> 复制 Session ID
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  if (!window.confirm(`删除对话「${activeSession.title}」？`)) return;
                  deleteSession.mutate(activeSession.id);
                }}
              >
                <Trash2 /> 删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <ThemeSwitch />
      </div>
    </header>
  );
}
