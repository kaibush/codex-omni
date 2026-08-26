import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  Blocks,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Folder,
  FolderPlus,
  GitFork,
  KeyRound,
  ListChecks,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Search,
  Settings,
  ShieldQuestion,
  Star,
  Trash2,
  Wifi,
  WifiOff
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyTextToClipboard } from "@/lib/clipboard";
import { requestSystemUpdateCheck } from "@/lib/system-update";
import { formatCompactDateTime, formatDataSize, formatDateTime } from "@/lib/utils";
import type { HostInfo, Project, Session } from "@/types";
import { SESSION_COLORS, SESSION_ICONS, sessionIcon } from "./session-appearance";
import { clampSidebarWidth, type ConnectionState } from "./workspace-model";

function SettingsToolsMenu({
  projectId,
  side = "top",
  align = "start",
  setTaskBoardOpen,
  setKnowledgeOpen,
  setSkillsOpen,
  setScheduleOpen,
  setApprovalOpen,
  setSettingsOpen,
  children
}: {
  projectId: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  setTaskBoardOpen: (open: boolean) => void;
  setKnowledgeOpen: (open: boolean) => void;
  setSkillsOpen: (open: boolean) => void;
  setScheduleOpen: (open: boolean) => void;
  setApprovalOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="min-w-48">
        <DropdownMenuItem disabled={!projectId} onSelect={() => setTaskBoardOpen(true)}>
          <ListChecks />
          任务看板
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setApprovalOpen(true)}>
          <ShieldQuestion />
          审批审计
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!projectId} onSelect={() => setKnowledgeOpen(true)}>
          <BookOpen />
          项目规则
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!projectId} onSelect={() => setSkillsOpen(true)}>
          <Blocks />
          Skills / MCP
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!projectId} onSelect={() => setScheduleOpen(true)}>
          <Clock3 />
          定时任务
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
          <Settings />
          系统信息
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkspaceSidebar({
  sidebar,
  isMobile,
  sidebarCollapsed,
  sidebarWidth,
  setSidebar,
  setSidebarCollapsed,
  setSidebarWidth,
  beginNewSession,
  startSessionPending,
  projectId,
  setPaletteOpen,
  showArchived,
  setShowArchived,
  archivedSessions,
  setNewProject,
  projectList,
  projectSort,
  setProjectSort,
  openWorkspace,
  renamingProjectId,
  setRenamingProjectId,
  projectRenameDraft,
  setProjectRenameDraft,
  saveProjectName,
  beginRenameProject,
  updateProject,
  deleteProject,
  projectSessions,
  sessionGroups,
  sessionId,
  sessionLoading,
  providerNames,
  sessionsPending,
  renamingSessionId,
  setRenamingSessionId,
  renameDraft,
  setRenameDraft,
  saveSessionTitle,
  beginRenameSession,
  startSessionLongPress,
  cancelSessionLongPress,
  forkSessionFrom,
  updateSession,
  archiveSession,
  exportSession,
  deleteSession,
  setSendNotice,
  activeRunsCount,
  pendingApprovalCount,
  connection,
  setTaskBoardOpen,
  setKnowledgeOpen,
  setSkillsOpen,
  setScheduleOpen,
  setRunningCenterOpen,
  setApprovalOpen,
  setProviderManager,
  setSettingsOpen,
  providersCount,
  host
}: {
  sidebar: boolean;
  isMobile: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  setSidebar: Dispatch<SetStateAction<boolean>>;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  beginNewSession: () => void;
  startSessionPending: boolean;
  projectId: string;
  setPaletteOpen: (open: boolean) => void;
  showArchived: boolean;
  setShowArchived: Dispatch<SetStateAction<boolean>>;
  archivedSessions: Session[];
  setNewProject: (open: boolean) => void;
  projectList: Project[];
  projectSort: "created" | "updated";
  setProjectSort: (value: "created" | "updated") => void;
  openWorkspace: (
    projectId: string,
    sessionId?: string,
    replace?: boolean,
    view?: "chat" | "files" | "git" | "terminal"
  ) => void;
  renamingProjectId: string;
  setRenamingProjectId: Dispatch<SetStateAction<string>>;
  projectRenameDraft: string;
  setProjectRenameDraft: Dispatch<SetStateAction<string>>;
  saveProjectName: (id: string) => void;
  beginRenameProject: (project: Project) => void;
  updateProject: {
    mutate: (input: { id: string; changes: { name?: string; pinned?: boolean } }) => void;
  };
  deleteProject: { mutate: (id: string) => void };
  projectSessions: Session[];
  sessionGroups: Array<{ key: string; label: string; items: Session[] }>;
  sessionId: string;
  sessionLoading: boolean;
  providerNames: Map<string, string>;
  sessionsPending: boolean;
  renamingSessionId: string;
  setRenamingSessionId: Dispatch<SetStateAction<string>>;
  renameDraft: string;
  setRenameDraft: Dispatch<SetStateAction<string>>;
  saveSessionTitle: (id: string) => void;
  beginRenameSession: (session: Session) => void;
  startSessionLongPress: (session: Session) => void;
  cancelSessionLongPress: () => void;
  forkSessionFrom: (messageId?: string, sourceId?: string) => void;
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
  activeRunsCount: number;
  pendingApprovalCount: number;
  connection: ConnectionState;
  setTaskBoardOpen: (open: boolean) => void;
  setKnowledgeOpen: (open: boolean) => void;
  setSkillsOpen: (open: boolean) => void;
  setScheduleOpen: (open: boolean) => void;
  setRunningCenterOpen: (open: boolean) => void;
  setApprovalOpen: (open: boolean) => void;
  setProviderManager: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  providersCount: number;
  host?: HostInfo | undefined;
}) {
  return (
    <>
      {isMobile && sidebar && (
        <button
          type="button"
          aria-label="关闭项目侧栏"
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-sm"
          onClick={() => setSidebar(false)}
        />
      )}
      {sidebar && (
        <aside
          className={`workspace-sidebar fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col shadow-2xl md:relative md:z-auto md:shadow-none ${
            sidebarCollapsed && !isMobile
              ? "is-collapsed w-12"
              : isMobile
                ? "w-[min(88vw,20rem)]"
                : ""
          }`}
          style={sidebarCollapsed || isMobile ? undefined : { width: sidebarWidth }}
        >
          <div
            className={`flex h-12 shrink-0 items-center border-b border-border ${
              sidebarCollapsed && !isMobile ? "justify-center px-1" : "gap-2.5 px-2.5"
            }`}
          >
            {!(sidebarCollapsed && !isMobile) ? (
              <>
                <span className="brand-mark grid size-8 shrink-0 place-items-center rounded-lg">
                  <Bot className="size-4 shrink-0" />
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-sm">Codex Omni</b>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    项目与会话工作台
                  </span>
                </div>
              </>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={sidebarCollapsed && !isMobile ? "展开项目侧栏" : "折叠项目侧栏"}
              onClick={() => {
                if (isMobile) setSidebar(false);
                else setSidebarCollapsed((value) => !value);
              }}
            >
              {sidebarCollapsed && !isMobile ? (
                <PanelLeftOpen className="size-4 shrink-0" />
              ) : (
                <PanelLeftClose className="size-4 shrink-0" />
              )}
            </Button>
          </div>
          {sidebarCollapsed && !isMobile ? (
            <div className="flex min-h-0 flex-1 flex-col items-center gap-1 px-1 py-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={beginNewSession}
                    disabled={!projectId || startSessionPending}
                    aria-label="新建对话"
                  >
                    <MessageSquarePlus className="size-4 shrink-0" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">新建对话</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-8 shrink-0"
                    onClick={() => setPaletteOpen(true)}
                    aria-label="搜索所有"
                  >
                    <Search className="size-4 shrink-0" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">搜索所有</TooltipContent>
              </Tooltip>
              <div className="mt-1 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-auto">
                {projectList.map((project) => {
                  const running = (project.id === projectId ? projectSessions : []).some(
                    (session) => session.status === "running"
                  );
                  return (
                    <Tooltip key={project.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={`relative grid size-8 shrink-0 place-items-center rounded-lg ${
                            project.id === projectId
                              ? "bg-sidebar-accent text-foreground"
                              : "text-muted-foreground hover:bg-muted"
                          }`}
                          aria-label={project.name}
                          onClick={() => openWorkspace(project.id, "", false, "chat")}
                        >
                          <Folder className="size-4 shrink-0" />
                          {project.pinnedAt ? (
                            <Star className="absolute -right-0.5 -top-0.5 size-2.5 fill-amber-400 text-amber-400" />
                          ) : null}
                          {running ? (
                            <span className="absolute bottom-1 right-1 size-1.5 rounded-full bg-emerald-500" />
                          ) : null}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {project.name}
                        {running ? " · 运行中" : ""}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              <div className="mt-auto flex flex-col items-center gap-1 pb-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="relative grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                      aria-label="运行中心"
                      onClick={() => setRunningCenterOpen(true)}
                    >
                      <Activity className="size-4 shrink-0" />
                      {activeRunsCount > 0 ? (
                        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[9px] text-primary-foreground">
                          {activeRunsCount}
                        </span>
                      ) : null}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">运行中 {activeRunsCount}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="relative grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                      aria-label="供应商"
                      onClick={() => setProviderManager(true)}
                    >
                      <KeyRound className="size-4 shrink-0" />
                      {providersCount > 0 ? (
                        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-muted px-1 text-[9px] text-muted-foreground">
                          {providersCount}
                        </span>
                      ) : null}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">供应商 {providersCount}</TooltipContent>
                </Tooltip>
                <SettingsToolsMenu
                  projectId={projectId}
                  side="right"
                  align="end"
                  setTaskBoardOpen={setTaskBoardOpen}
                  setKnowledgeOpen={setKnowledgeOpen}
                  setSkillsOpen={setSkillsOpen}
                  setScheduleOpen={setScheduleOpen}
                  setApprovalOpen={setApprovalOpen}
                  setSettingsOpen={setSettingsOpen}
                >
                  <button
                    type="button"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                    aria-label="系统设置"
                    title={host?.app.version ? `系统设置 · v${host.app.version}` : "系统设置"}
                  >
                    <Settings className="size-4 shrink-0" />
                  </button>
                </SettingsToolsMenu>
              </div>
            </div>
          ) : (
            <>
              <div className="shrink-0 px-2.5 pb-1.5 pt-2.5">
                <Button
                  className="w-full justify-start"
                  onClick={beginNewSession}
                  disabled={!projectId || startSessionPending}
                >
                  <MessageSquarePlus className="size-4" />
                  新建对话
                </Button>
                <button
                  type="button"
                  className="mt-1.5 flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-left text-xs text-muted-foreground hover:bg-muted"
                  onClick={() => setPaletteOpen(true)}
                >
                  <Search className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">搜索所有</span>
                  <kbd className="command-kbd">
                    {typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
                      ? "⌘K"
                      : "Ctrl+K"}
                  </kbd>
                </button>
                <button
                  type="button"
                  className={`mt-1 flex h-7 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs ${
                    showArchived
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => setShowArchived((value) => !value)}
                >
                  {showArchived ? (
                    <ArchiveRestore className="size-3.5" />
                  ) : (
                    <Archive className="size-3.5" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {showArchived ? "隐藏归档" : "显示归档"}
                  </span>
                  <span className="tabular-nums">{archivedSessions.length}</span>
                </button>
              </div>
              <div className="mt-1 min-h-0 flex-1 overflow-auto px-2 pb-1.5">
                <div className="mb-1 flex items-center gap-0.5 px-1 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
                  <span className="min-w-0 flex-1 truncate">工程项目</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="工程排序规则"
                        title={projectSort === "updated" ? "最近更新" : "创建时间"}
                      >
                        <ArrowUpDown className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-36">
                      <DropdownMenuItem onSelect={() => setProjectSort("created")}>
                        创建时间
                        {projectSort === "created" ? <Check className="ms-auto size-3.5" /> : null}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setProjectSort("updated")}>
                        最近更新
                        {projectSort === "updated" ? <Check className="ms-auto size-3.5" /> : null}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button
                    type="button"
                    className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="新建工程"
                    onClick={() => setNewProject(true)}
                  >
                    <FolderPlus className="size-3.5" />
                  </button>
                </div>
                {projectList.map((project) => (
                  <div key={project.id} className="mb-1">
                    <div
                      className={`project-row group flex w-full items-center gap-0.5 rounded-lg px-1 py-1 text-sm ${project.id === projectId ? "active font-medium" : ""}`}
                    >
                      {renamingProjectId === project.id ? (
                        <Input
                          autoFocus
                          value={projectRenameDraft}
                          onChange={(event) => setProjectRenameDraft(event.target.value)}
                          onBlur={() => saveProjectName(project.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") saveProjectName(project.id);
                            if (event.key === "Escape") {
                              setRenamingProjectId("");
                              setProjectRenameDraft("");
                            }
                          }}
                          className="h-7 min-w-0 flex-1 px-2 text-sm"
                          aria-label="编辑工程名称"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            openWorkspace(project.id, "", false, "chat");
                            if (isMobile) setSidebar(false);
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            beginRenameProject(project);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left"
                        >
                          <ChevronDown className="size-3" />
                          <Folder className="size-4 text-primary" />
                          <span className="min-w-0 truncate">
                            <span className="block truncate">
                              {project.pinnedAt ? "★ " : ""}
                              {project.name}
                            </span>
                            <span className="block truncate text-[10px] font-normal text-muted-foreground">
                              {formatCompactDateTime(
                                projectSort === "updated" ? project.updatedAt : project.createdAt
                              )}
                            </span>
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={project.pinnedAt ? "取消收藏" : "收藏工程"}
                        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation();
                          updateProject.mutate({
                            id: project.id,
                            changes: { pinned: !project.pinnedAt }
                          });
                        }}
                      >
                        <Star
                          className={`size-3.5 ${project.pinnedAt ? "fill-amber-400 text-amber-400" : ""}`}
                        />
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`${project.name} 菜单`}
                            className="shrink-0 rounded-md p-1 text-muted-foreground opacity-100 hover:bg-accent md:opacity-0 md:group-hover:opacity-100"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => beginRenameProject(project)}>
                            <Pencil /> 重命名
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              updateProject.mutate({
                                id: project.id,
                                changes: { pinned: !project.pinnedAt }
                              })
                            }
                          >
                            <Star /> {project.pinnedAt ? "取消收藏" : "收藏"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              void copyTextToClipboard(project.displayPath).then((copied) =>
                                copied ? toast.success("已复制路径") : toast.error("复制失败")
                              );
                            }}
                          >
                            <Copy /> 复制路径
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              if (
                                !window.confirm(
                                  `删除项目「${project.name}」及其对话？磁盘上的项目文件不会删除。`
                                )
                              )
                                return;
                              deleteProject.mutate(project.id);
                            }}
                          >
                            <Trash2 /> 删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {project.id === projectId && (
                      <div className="ml-4 mt-0.5 border-l border-border pl-1.5">
                        {sessionGroups.map((group) => (
                          <section key={group.key} className="mb-1">
                            <div className="flex h-5 items-center px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                              {group.label} · {group.items.length}
                            </div>
                            {group.items.map((s) => (
                              <div
                                key={s.id}
                                className={`session-row group my-px flex min-h-8 w-full items-center gap-0.5 rounded-md px-1 py-0.5 text-xs ${
                                  s.id === sessionId ? "active" : "text-muted-foreground"
                                } ${s.archivedAt ? "opacity-75" : ""}`}
                                style={
                                  s.color
                                    ? {
                                        boxShadow: `inset 3px 0 0 ${SESSION_COLORS.find((item) => item.id === s.color)?.swatch ?? "transparent"}`
                                      }
                                    : undefined
                                }
                              >
                                {(() => {
                                  const Icon = sessionIcon(s.icon);
                                  return Icon ? (
                                    <Icon className="ml-1 size-3.5 shrink-0" />
                                  ) : (
                                    <span
                                      title={
                                        s.status === "running"
                                          ? "任务进行中"
                                          : s.status === "failed"
                                            ? "任务异常中断"
                                            : s.status === "cancelled"
                                              ? "已手动终止"
                                              : s.status === "interrupted"
                                                ? "任务未完成（已中断）"
                                                : "空闲"
                                      }
                                      className={`ml-1 size-1.5 shrink-0 rounded-full ${
                                        s.status === "running"
                                          ? "animate-pulse bg-emerald-500"
                                          : s.status === "failed"
                                            ? "bg-red-500"
                                            : s.status === "cancelled"
                                              ? "bg-muted-foreground"
                                              : s.status === "interrupted"
                                                ? "bg-amber-500"
                                                : "bg-border"
                                      }`}
                                    />
                                  );
                                })()}
                                {renamingSessionId === s.id ? (
                                  <Input
                                    autoFocus
                                    value={renameDraft}
                                    onChange={(event) => setRenameDraft(event.target.value)}
                                    onBlur={() => saveSessionTitle(s.id)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") saveSessionTitle(s.id);
                                      if (event.key === "Escape") {
                                        setRenamingSessionId("");
                                        setRenameDraft("");
                                      }
                                    }}
                                    className="h-7 min-w-0 flex-1 px-2 text-xs"
                                    aria-label="重命名 Session"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    title={s.title}
                                    onClick={() => {
                                      openWorkspace(projectId, s.id, false, "chat");
                                      if (isMobile) setSidebar(false);
                                    }}
                                    onDoubleClick={() => beginRenameSession(s)}
                                    onContextMenu={(event) => {
                                      event.preventDefault();
                                      beginRenameSession(s);
                                    }}
                                    onTouchStart={() => startSessionLongPress(s)}
                                    onTouchEnd={cancelSessionLongPress}
                                    onTouchMove={cancelSessionLongPress}
                                    onTouchCancel={cancelSessionLongPress}
                                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left"
                                  >
                                    <span className="min-w-0 flex-1">
                                      <span className="flex items-center gap-1">
                                        {s.pinnedAt ? (
                                          <Pin className="size-3 shrink-0 text-primary" />
                                        ) : null}
                                        <span className="truncate">{s.title}</span>
                                        {s.id === sessionId && sessionLoading && (
                                          <LoaderCircle className="size-3 shrink-0 animate-spin text-primary" />
                                        )}
                                      </span>
                                      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                                        <span
                                          className="truncate font-mono"
                                          title={formatDateTime(s.lastMessageAt ?? s.createdAt)}
                                        >
                                          {formatCompactDateTime(s.lastMessageAt ?? s.createdAt)}
                                        </span>
                                        {s.providerId ? (
                                          <span className="truncate">
                                            · {providerNames.get(s.providerId)}
                                          </span>
                                        ) : null}
                                      </span>
                                    </span>
                                  </button>
                                )}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-100 hover:bg-accent hover:text-foreground md:opacity-0 md:group-hover:opacity-100"
                                      aria-label={`${s.title} 的更多操作`}
                                    >
                                      <MoreHorizontal className="size-3.5" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-48">
                                    <DropdownMenuItem onSelect={() => beginRenameSession(s)}>
                                      <Pencil /> 重命名
                                    </DropdownMenuItem>
                                    <div className="flex flex-wrap gap-1 px-2 py-1.5">
                                      {SESSION_COLORS.map((color) => (
                                        <button
                                          key={color.id}
                                          type="button"
                                          className={`size-4 rounded-full ${color.className} ${s.color === color.id ? "ring-2 ring-offset-1 ring-foreground" : ""}`}
                                          aria-label={`颜色 ${color.id}`}
                                          onClick={() =>
                                            updateSession.mutate({
                                              id: s.id,
                                              changes: {
                                                color: s.color === color.id ? null : color.id
                                              }
                                            })
                                          }
                                        />
                                      ))}
                                    </div>
                                    <div className="flex flex-wrap gap-1 px-2 pb-1.5">
                                      {SESSION_ICONS.map((item) => {
                                        const Icon = item.icon;
                                        return (
                                          <button
                                            key={item.id}
                                            type="button"
                                            className={`grid size-6 place-items-center rounded-md ${s.icon === item.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`}
                                            aria-label={item.label}
                                            onClick={() =>
                                              updateSession.mutate({
                                                id: s.id,
                                                changes: {
                                                  icon: s.icon === item.id ? null : item.id
                                                }
                                              })
                                            }
                                          >
                                            <Icon className="size-3.5" />
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        const next = window.prompt(
                                          "标签，用逗号分隔",
                                          (s.tags ?? []).join(", ")
                                        );
                                        if (next == null) return;
                                        updateSession.mutate({
                                          id: s.id,
                                          changes: {
                                            tags: next
                                              .split(/[,，]/)
                                              .map((item) => item.trim())
                                              .filter(Boolean)
                                              .slice(0, 8)
                                          }
                                        });
                                      }}
                                    >
                                      标签
                                      {(s.tags ?? []).length
                                        ? ` · ${(s.tags ?? []).join(" / ")}`
                                        : ""}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        void forkSessionFrom(undefined, s.id);
                                      }}
                                    >
                                      <GitFork /> 从此处分叉
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        updateSession.mutate({
                                          id: s.id,
                                          changes: { pinned: !s.pinnedAt }
                                        })
                                      }
                                    >
                                      {s.pinnedAt ? <PinOff /> : <Pin />}
                                      {s.pinnedAt ? "取消置顶" : "置顶"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => archiveSession(s, !s.archivedAt)}
                                    >
                                      {s.archivedAt ? <ArchiveRestore /> : <Archive />}
                                      {s.archivedAt ? "恢复归档" : "归档"}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onSelect={() => exportSession(s.id, "markdown")}
                                    >
                                      <Download /> 导出 Markdown
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => exportSession(s.id, "json")}>
                                      <Download /> 导出 JSON
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        void copyTextToClipboard(s.id).then((copied) =>
                                          setSendNotice(
                                            copied ? "已复制 Session ID" : "复制失败，请手动选择"
                                          )
                                        );
                                      }}
                                    >
                                      <Copy /> 复制 Session ID
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() => {
                                        if (!window.confirm(`删除对话「${s.title}」？`)) return;
                                        deleteSession.mutate(s.id);
                                      }}
                                    >
                                      <Trash2 /> 删除
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            ))}
                            {group.key === "archived" && group.items.length === 0 ? (
                              <p className="px-2 py-3 text-[11px] text-muted-foreground">
                                暂无归档会话
                              </p>
                            ) : null}
                          </section>
                        ))}
                        {!sessionsPending &&
                        sessionGroups.every((group) => group.items.length === 0) ? (
                          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                            暂无会话
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-border bg-background/60 p-2 pb-[max(.5rem,env(safe-area-inset-bottom))]">
                {host ? (
                  <button
                    type="button"
                    className="sidebar-host"
                    title="检查更新"
                    aria-label={`检查更新 v${host.app.version}，${host.cpu.cores} 核 ${host.cpu.usage}%，内存 ${formatDataSize(host.memory.used, true)}/${formatDataSize(host.memory.total, true)}，存储 ${formatDataSize(host.storage.used, true)}/${formatDataSize(host.storage.total, true)}`}
                    onClick={() => requestSystemUpdateCheck()}
                  >
                    <span title={`版本 v${host.app.version}`}>v{host.app.version}</span>
                    <span title={`${host.cpu.cores} 核 · ${host.cpu.usage}%`}>
                      {host.cpu.cores} 核 · {host.cpu.usage}%
                    </span>
                    <span title={`内存 ${formatDataSize(host.memory.used, true)}/${formatDataSize(host.memory.total, true)}`}>
                      内存 {formatDataSize(host.memory.used, true)}/{formatDataSize(host.memory.total, true)}
                    </span>
                    <span title={`存储 ${formatDataSize(host.storage.used, true)}/${formatDataSize(host.storage.total, true)}`}>
                      存储 {formatDataSize(host.storage.used, true)}/{formatDataSize(host.storage.total, true)}
                    </span>
                  </button>
                ) : null}
                <div className="sidebar-status-strip" aria-label="工作台状态">
                  <span title="运行中的 Session">
                    <Activity className="size-3" />
                    运行中 {activeRunsCount}
                  </span>
                  <span title="待审批">
                    <ShieldQuestion className="size-3" />
                    待审批 {pendingApprovalCount}
                  </span>
                  <span
                    title={
                      connection === "connected"
                        ? "服务已连接"
                        : connection === "reconnecting"
                          ? "正在重连"
                          : connection === "connecting"
                            ? "正在连接"
                            : "服务已断开"
                    }
                  >
                    {connection === "connected" ? (
                      <Wifi className="size-3 text-emerald-500" />
                    ) : connection === "disconnected" ? (
                      <WifiOff className="size-3 text-red-500" />
                    ) : (
                      <LoaderCircle className="size-3 animate-spin text-amber-500" />
                    )}
                    {connection === "connected"
                      ? "已连接"
                      : connection === "reconnecting"
                        ? "重连中"
                        : connection === "connecting"
                          ? "连接中"
                          : "已断开"}
                  </span>
                </div>
                <div className="sidebar-tools">
                  <button
                    type="button"
                    onClick={() => setRunningCenterOpen(true)}
                    className="sidebar-action"
                  >
                    <Activity />
                    运行中心
                    <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {activeRunsCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setProviderManager(true)}
                    className="sidebar-action"
                  >
                    <KeyRound />
                    供应商
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {providersCount}
                    </span>
                  </button>
                  <SettingsToolsMenu
                    projectId={projectId}
                    setTaskBoardOpen={setTaskBoardOpen}
                    setKnowledgeOpen={setKnowledgeOpen}
                    setSkillsOpen={setSkillsOpen}
                    setScheduleOpen={setScheduleOpen}
                    setApprovalOpen={setApprovalOpen}
                    setSettingsOpen={setSettingsOpen}
                  >
                    <button type="button" className="sidebar-action">
                      <Settings />
                      系统设置
                      <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                    </button>
                  </SettingsToolsMenu>
                </div>
              </div>
            </>
          )}
          {!(sidebarCollapsed || isMobile) ? (
            <div
              className="sidebar-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整侧栏宽度"
              onPointerDown={(event) => {
                event.preventDefault();
                const handle = event.currentTarget;
                handle.classList.add("is-dragging");
                const startX = event.clientX;
                const startWidth = sidebarWidth;
                const move = (next: PointerEvent) => {
                  setSidebarWidth(clampSidebarWidth(startWidth + next.clientX - startX));
                };
                const up = () => {
                  handle.classList.remove("is-dragging");
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
            />
          ) : null}
        </aside>
      )}
    </>
  );
}
