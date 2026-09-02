import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { applyTextPatch, compactTimelineItem } from "@codex-omni/protocol";
import { useNavigate, useParams } from "react-router";
import { FolderPlus, LoaderCircle, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ThemeSwitch } from "@/components/theme-switch";
import { useTheme } from "@/context/theme-provider";
import { api, apiUpload, wsUrl } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { defaultWorkspaceView, settingsPath, workspacePath } from "@/lib/routes";
import { shouldContinueWithProvider, timelineHasConversation } from "@/lib/provider-continuation";
import {
  isPlaceholderSessionTitle,
  listHistoricalSessions,
  sortSessionsByLatest,
  titleFromFirstMessage
} from "@/lib/session-title";
import {
  beginRunningTaskState,
  patchTaskState,
  reconcileTaskState,
  resolveTaskState
} from "@/lib/task-state";
import { mergeSessionTimeline } from "@/lib/timeline";
import { createId } from "@/lib/utils";
import type {
  Message,
  MessageCursor,
  Project,
  Provider,
  QueuedTurn,
  PromptTemplate,
  RuntimeInfo,
  Session,
  SessionDetailPage,
  SessionSnapshot,
  TimelineItem
} from "@/types";
import { ApprovalAuditDialog } from "@/features/workspace/ApprovalAuditDialog";
import { CommandPalette } from "@/features/workspace/CommandPalette";
import type { PaletteAction } from "@/features/workspace/command-palette";
import { quoteMarkdown } from "@/features/workspace/markdown-refs";
import { summarizeMessageText } from "@/features/workspace/message-summary";
import { NewProjectDialog } from "@/features/workspace/NewProjectDialog";
import { NewSessionDialog } from "@/features/workspace/NewSessionDialog";
import { ProviderContinuationDialog } from "@/features/workspace/ProviderContinuationDialog";
import { ProviderDialog } from "@/features/workspace/ProviderDialog";
import { ProjectFilesPanel } from "@/features/workspace/ProjectFilesPanel";
import {
  approvalSummary,
  ATTACHMENT_UPLOAD_DIR,
  attachmentUploadPath,
  buildAttachmentPrompt,
  collectComposerAttachments,
  formatContextEstimate,
  parseComposerDraft,
  queuedAttachmentMeta,
  sendBlockReason,
  stringifyComposerDraft,
  type ComposerAttachment
} from "@/features/workspace/composer-attachments";
import {
  expandSlashCommand,
  extractMentions,
  type SlashCommand
} from "@/features/workspace/composer-mentions";
import type { FilePreview, FileSearchMatch } from "@/features/workspace/file-workspace";
import { RunningCenterDialog, useActiveRuns } from "@/features/workspace/RunningCenterDialog";
import { ProjectKnowledgeDialog } from "@/features/workspace/ProjectKnowledgeDialog";
import { ScheduleDialog } from "@/features/workspace/ScheduleDialog";
import { SkillsMcpDialog } from "@/features/workspace/SkillsMcpDialog";
import { TaskBoardDialog } from "@/features/workspace/TaskBoardDialog";
import {
  defaultWorkspaceSettings,
  type WorkspaceSettings
} from "@/features/workspace/SettingsDialog";
import { WorkspaceComposer } from "@/features/workspace/WorkspaceComposer";
import { WorkspaceHeader } from "@/features/workspace/WorkspaceHeader";
import { WorkspaceSidebar } from "@/features/workspace/WorkspaceSidebar";
import { WorkspaceTimeline } from "@/features/workspace/WorkspaceTimeline";
import {
  SESSION_PAGE_SIZE,
  formatDuration,
  formatTokens,
  fromMessage,
  isVisibleTimelineMessage,
  loadOutboundCommands,
  loadSidebarWidth,
  persistOutboundCommands,
  persistSidebarWidth,
  reconnectNoticeFrom,
  replayCursorKey,
  upsert,
  type ConnectionState,
  type QueuedCommand,
  type ReplayCursor,
  type RunState,
  type WorkspaceView
} from "@/features/workspace/workspace-model";

const TerminalPanel = lazy(() =>
  import("@/features/workspace/TerminalPanel").then((module) => ({
    default: module.TerminalPanel
  }))
);

export function Workspace() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const params = useParams<{ projectId?: string; sessionId?: string; section?: string }>();
  const projectId = params.projectId ?? "";
  const sessionId = params.sessionId ?? "";
  const [providerId, setProviderId] = useState("");
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachError, setAttachError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [sending, setSending] = useState(false);
  const [mentionItems, setMentionItems] = useState<FileSearchMatch[]>([]);
  const [mentionRange, setMentionRange] = useState<{ start: number; query: string } | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState<{
    id: string;
    format: "markdown" | "json";
    reasoning: boolean;
    tools: boolean;
  } | null>(null);
  const [events, setEvents] = useState<TimelineItem[]>([]);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [sidebar, setSidebar] = useState(() => window.innerWidth >= 768);
  const [newProject, setNewProject] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [providerManager, setProviderManager] = useState(false);
  const [runningCenterOpen, setRunningCenterOpen] = useState(false);
  const [taskBoardOpen, setTaskBoardOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [continuation, setContinuation] = useState<Provider | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [runState, setRunState] = useState<RunState | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [sendNotice, setSendNotice] = useState("");
  const [model, setModel] = useState("");
  const [runtimeOptionsOpen, setRuntimeOptionsOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(() =>
    defaultWorkspaceView(params.sessionId)
  );
  const openWorkspace = useCallback(
    (nextProjectId: string, nextSessionId = "", replace = false, view?: WorkspaceView) => {
      setWorkspaceView(view ?? defaultWorkspaceView(nextSessionId));
      const path = workspacePath(nextProjectId, nextSessionId);
      if (window.location.pathname === path) return;
      navigate(path, { replace });
    },
    [navigate]
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState("");
  const [starredIds, setStarredIds] = useState<string[]>([]);
  const [messageHits, setMessageHits] = useState<
    Array<{ projectId: string; sessionId: string; messageId: string }>
  >([]);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [gitCount, setGitCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("codex-omni:sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [projectSort, setProjectSort] = useState<"created" | "updated">(() => {
    try {
      return localStorage.getItem("codex-omni:project-sort") === "updated" ? "updated" : "created";
    } catch {
      return "created";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("codex-omni:project-sort", projectSort);
    } catch {
      // private browsing
    }
  }, [projectSort]);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [projectRenameDraft, setProjectRenameDraft] = useState("");
  const [createFile, setCreateFile] = useState<{ content: string; language: string } | null>(null);
  const [createFilePath, setCreateFilePath] = useState("");
  const [openFileRequest, setOpenFileRequest] = useState<{
    path: string;
    line: number | null;
  } | null>(null);
  const [editorCommand, setEditorCommand] = useState<"goto-line" | "toggle-outline" | null>(null);
  const [enhanceNonce, setEnhanceNonce] = useState(0);
  const [focusCommit, setFocusCommit] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const longPressTimer = useRef<number | null>(null);
  const [queuedTurns, setQueuedTurns] = useState<QueuedTurn[]>([]);
  const [editingQueueId, setEditingQueueId] = useState("");
  const [queueDraft, setQueueDraft] = useState("");
  const [historyCursor, setHistoryCursor] = useState<MessageCursor | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const queuedCommands = useRef<QueuedCommand[]>(loadOutboundCommands());
  const replayCursors = useRef(new Map<string, ReplayCursor>());
  const reconnectAttempts = useRef(0);
  const draftSessionKey = useRef("");
  const pendingContinuationSend = useRef<{
    sessionId: string;
    message: string;
    providerId: string;
  } | null>(null);
  const chatScroll = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const historyLoadingRef = useRef(false);
  const historyRequestId = useRef(0);
  const historyExpanded = useRef(false);
  const historyScrollSnapshot = useRef<{ height: number; top: number } | null>(null);
  const currentSessionId = useRef(sessionId);
  const clockOffsetRef = useRef(0);
  currentSessionId.current = sessionId;
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects")
  });
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => api<Provider[]>("/api/providers")
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<WorkspaceSettings>("/api/settings")
  });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<PromptTemplate[]>("/api/templates")
  });
  const runtime = useQuery({
    queryKey: ["runtime"],
    queryFn: () => api<RuntimeInfo>("/api/runtime"),
    refetchInterval: 30_000
  });
  const activeRuns = useActiveRuns(true);
  const pendingApprovalQuery = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => api<Array<{ id: string }>>("/api/approvals?status=pending&limit=50"),
    refetchInterval: 4000
  });
  const workspaceSettings = { ...defaultWorkspaceSettings, ...(settings.data ?? {}) };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      if (event.ctrlKey && !event.metaKey && workspaceView === "terminal") return;
      event.preventDefault();
      setPaletteOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [workspaceView]);
  useEffect(() => {
    try {
      localStorage.setItem("codex-omni:sidebar-collapsed", sidebarCollapsed ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }, [sidebarCollapsed]);
  useEffect(() => {
    persistSidebarWidth(sidebarWidth);
  }, [sidebarWidth]);
  useEffect(() => {
    if (!sessionId) {
      setStarredIds([]);
      return;
    }
    let cancelled = false;
    void api<{ ids: string[] }>(`/api/sessions/${sessionId}/stars`)
      .then((result) => {
        if (!cancelled) setStarredIds(result.ids);
      })
      .catch(() => {
        if (!cancelled) setStarredIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);
  useEffect(() => {
    const applyHash = () => {
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (hash) setHighlightMessageId(hash);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [sessionId]);
  useEffect(() => {
    if (!highlightMessageId) return;
    const node = document.querySelector(`[data-message-id="${CSS.escape(highlightMessageId)}"]`);
    if (!(node instanceof HTMLElement)) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setHighlightMessageId(""), 5000);
    return () => window.clearTimeout(timer);
  }, [events, highlightMessageId]);
  const sessions = useQuery({
    queryKey: ["sessions", projectId],
    queryFn: () => api<Session[]>(`/api/projects/${projectId}/sessions?archived=true`),
    enabled: Boolean(projectId)
  });
  const projectSessions = useMemo(() => sortSessionsByLatest(sessions.data ?? []), [sessions.data]);
  const archivedSessions = useMemo(
    () => projectSessions.filter((session) => session.archivedAt),
    [projectSessions]
  );
  const sessionGroups = useMemo(
    () =>
      [
        {
          key: "pinned",
          label: "置顶",
          items: projectSessions.filter((session) => session.pinnedAt && !session.archivedAt)
        },
        {
          key: "recent",
          label: "最近",
          items: projectSessions.filter((session) => !session.pinnedAt && !session.archivedAt)
        },
        ...(showArchived
          ? [
              {
                key: "archived",
                label: "已归档",
                items: archivedSessions
              }
            ]
          : [])
      ].filter((group) => group.key === "archived" || group.items.length > 0),
    [archivedSessions, projectSessions, showArchived]
  );
  const projectList = useMemo(() => {
    const list = [...(projects.data ?? [])];
    list.sort((left, right) => {
      const leftPinned = left.pinnedAt ?? 0;
      const rightPinned = right.pinnedAt ?? 0;
      if (Boolean(leftPinned) !== Boolean(rightPinned)) return rightPinned ? 1 : -1;
      if (leftPinned && rightPinned && leftPinned !== rightPinned) return rightPinned - leftPinned;
      const leftValue = projectSort === "updated" ? left.updatedAt : left.createdAt;
      const rightValue = projectSort === "updated" ? right.updatedAt : right.createdAt;
      return (
        rightValue - leftValue ||
        right.createdAt - left.createdAt ||
        left.name.localeCompare(right.name)
      );
    });
    return list;
  }, [projectSort, projects.data]);
  const detail = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api<SessionDetailPage>(`/api/sessions/${sessionId}?limit=${SESSION_PAGE_SIZE}`),
    enabled: Boolean(sessionId),
    refetchOnWindowFocus: false
  });
  useEffect(() => {
    const fallback = projectList[0];
    if (!fallback) return;
    if (!projectId || !projectList.some((project) => project.id === projectId)) {
      openWorkspace(fallback.id, "", true);
    }
  }, [projectId, projectList, openWorkspace]);
  useEffect(() => {
    const updateViewport = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setSidebar(true);
    };
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);
  useEffect(() => {
    setEvents([]);
    setRunState(null);
    setSendNotice("");
    setContinuation(null);
    setQueuedTurns([]);
    setEditingQueueId("");
    setQueueDraft("");
    setAttachments([]);
    setAttachError("");
    setDragActive(false);
    setSending(false);
    stickToBottom.current = true;
    setHistoryCursor(null);
    setHasOlderMessages(false);
    setHistoryLoading(false);
    historyRequestId.current += 1;
    historyLoadingRef.current = false;
    historyExpanded.current = false;
    historyScrollSnapshot.current = null;
  }, [projectId, sessionId]);
  useEffect(() => {
    const key = sessionId ? `codex-omni:draft:${projectId}:${sessionId}` : "";
    draftSessionKey.current = key;
    const draft = parseComposerDraft(key ? localStorage.getItem(key) : null);
    setInput(draft.text);
    setAttachments(draft.attachments);
    setAttachError("");
  }, [projectId, sessionId]);
  useEffect(() => {
    const key = draftSessionKey.current;
    if (!key) return;
    const timer = window.setTimeout(() => {
      if (input || attachments.length)
        localStorage.setItem(key, stringifyComposerDraft(input, attachments));
      else localStorage.removeItem(key);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [attachments, input]);
  useEffect(() => {
    const selected = detail.data?.session;
    if (selected)
      setProviderId(
        selected.providerId ??
          projects.data?.find((p) => p.id === selected.projectId)?.providerId ??
          ""
      );
  }, [detail.data?.session, projects.data]);
  useEffect(() => {
    if (!detail.data || detail.data.session.id !== sessionId) return;
    const messages = detail.data.messages;
    const historical = messages.filter(isVisibleTimelineMessage).map((message) => fromMessage(message));
    const expanded = historyExpanded.current;
    setEvents((current) =>
      mergeSessionTimeline({
        historical,
        current,
        historyExpanded: expanded
      })
    );
    if (!expanded) {
      setHistoryCursor(detail.data.nextCursor);
      setHasOlderMessages(detail.data.hasMore);
    }
    const resolved = resolveTaskState({
      sessionStatus: detail.data.session.status,
      messages: detail.data.latestRun ? [...messages, detail.data.latestRun] : messages
    });
    setRunState((current) => reconcileTaskState(current, resolved));
  }, [detail.data?.messages, detail.data?.latestRun, detail.data?.session.status, sessionId]);
  useLayoutEffect(() => {
    const container = chatScroll.current;
    if (!container) return;
    const snapshot = historyScrollSnapshot.current;
    if (snapshot) {
      container.scrollTop = snapshot.top + (container.scrollHeight - snapshot.height);
      historyScrollSnapshot.current = null;
      return;
    }
    if (!stickToBottom.current || historyLoadingRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [events, runState]);
  const providerIdRef = useRef(providerId);
  providerIdRef.current = providerId;
  const workspaceSettingsRef = useRef(workspaceSettings);
  workspaceSettingsRef.current = workspaceSettings;
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | undefined;
    setConnection(reconnectAttempts.current ? "reconnecting" : "connecting");
    const ws = new WebSocket(wsUrl());
    socket.current = ws;

    const recordCursor = (requestId: unknown, seq: unknown) => {
      if (typeof requestId !== "string" || typeof seq !== "number") return;
      const current = replayCursors.current.get(sessionId);
      const next =
        current?.requestId === requestId
          ? { requestId, lastSeq: Math.max(current.lastSeq, seq) }
          : { requestId, lastSeq: seq };
      replayCursors.current.set(sessionId, next);
      try {
        localStorage.setItem(replayCursorKey(sessionId), JSON.stringify(next));
      } catch {
        // Cursor persistence is an optimization; in-memory replay remains available.
      }
    };
    const refreshSession = () => {
      void qc.invalidateQueries({ queryKey: ["sessions", projectId] });
      void qc.invalidateQueries({ queryKey: ["session", sessionId] });
      void qc.invalidateQueries({ queryKey: ["active-runs"] });
    };
    const cachedCursor = () => {
      const inMemory = replayCursors.current.get(sessionId);
      if (inMemory) return inMemory;
      try {
        const stored = JSON.parse(localStorage.getItem(replayCursorKey(sessionId)) ?? "null");
        if (stored && typeof stored.requestId === "string" && typeof stored.lastSeq === "number") {
          replayCursors.current.set(sessionId, stored);
          return stored as ReplayCursor;
        }
      } catch {
        localStorage.removeItem(replayCursorKey(sessionId));
      }
      return undefined;
    };

    ws.onopen = () => {
      if (disposed) return;
      reconnectAttempts.current = 0;
      setConnection("connected");
      if (sessionId) {
        const cursor = cachedCursor();
        ws.send(
          JSON.stringify({
            type: "session.subscribe",
            sessionId,
            ...(cursor ? { lastRequestId: cursor.requestId, lastSeq: cursor.lastSeq } : {})
          })
        );
      }
      const pendingCommands = queuedCommands.current;
      for (const pending of pendingCommands) ws.send(pending.data);
      if (pendingCommands.length) setSendNotice("正在确认待发送消息");

      const pending = pendingContinuationSend.current;
      if (pending && pending.sessionId === sessionId) {
        const clientId = createId();
        ws.send(
          JSON.stringify({
            type: "turn.enqueue",
            clientId,
            projectId,
            sessionId,
            message: pending.message,
            providerId: pending.providerId,
            sandbox: workspaceSettingsRef.current.sandbox,
            approvalPolicy: workspaceSettingsRef.current.approvalPolicy,
            networkAccessEnabled: workspaceSettingsRef.current.networkAccessEnabled
          })
        );
        queuedCommands.current = [
          ...queuedCommands.current.filter((item) => item.id !== clientId),
          {
            id: clientId,
            sessionId,
            data: JSON.stringify({
              type: "turn.enqueue",
              clientId,
              projectId,
              sessionId,
              message: pending.message,
              providerId: pending.providerId,
              sandbox: workspaceSettingsRef.current.sandbox,
              approvalPolicy: workspaceSettingsRef.current.approvalPolicy,
              networkAccessEnabled: workspaceSettingsRef.current.networkAccessEnabled
            }),
            message: pending.message
          }
        ];
        persistOutboundCommands(queuedCommands.current);
        setQueuedTurns((current) => [
          ...current,
          {
            id: clientId,
            sessionId,
            projectId,
            providerId: pending.providerId,
            message: pending.message,
            options: {},
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]);
        pendingContinuationSend.current = null;
        setInput("");
      }
    };
    ws.onerror = () => {
      if (!disposed) setConnection("reconnecting");
    };
    ws.onclose = () => {
      if (disposed) return;
      socket.current = null;
      reconnectAttempts.current += 1;
      setConnection(reconnectAttempts.current >= 5 ? "disconnected" : "reconnecting");
      reconnectTimer = window.setTimeout(
        () => setReconnectNonce((value) => value + 1),
        Math.min(8000, 800 * 2 ** Math.min(reconnectAttempts.current - 1, 4))
      );
    };
    ws.onmessage = (message) => {
      let event: Record<string, any>;
      try {
        event = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (event.type === "server.error") {
        const text = String(event.payload?.message ?? "Server command failed");
        if (typeof event.payload?.clientId === "string") {
          queuedCommands.current = queuedCommands.current.filter(
            (item) => item.id !== event.payload.clientId
          );
          persistOutboundCommands(queuedCommands.current);
        }
        if (!event.sessionId || event.sessionId === sessionId) {
          setSendNotice(text);
          setEvents((current) =>
            upsert(current, `server-error-${Date.now()}`, {
              kind: "error",
              text,
              providerId: providerIdRef.current,
              createdAt: Date.now()
            })
          );
        }
        return;
      }
      if (event.type === "queue.acknowledged") {
        const queueId = String(event.payload?.queueId ?? "");
        if (queueId) {
          queuedCommands.current = queuedCommands.current.filter((item) => item.id !== queueId);
          persistOutboundCommands(queuedCommands.current);
        }
        if (event.sessionId === sessionId && event.payload?.status === "running") {
          setQueuedTurns((current) => current.filter((item) => item.id !== queueId));
        }
        return;
      }
      if (event.sessionId !== sessionId) return;
      const payload = (event.payload ?? {}) as Record<string, any>;

      if (event.type === "session.snapshot") {
        const snapshot = payload as SessionSnapshot;
        if (snapshot.session) {
          qc.setQueriesData<Session[]>({ queryKey: ["sessions", projectId] }, (current) =>
            current?.map((item) =>
              item.id === snapshot.session.id ? { ...item, ...snapshot.session } : item
            )
          );
          qc.setQueryData<SessionDetailPage>(["session", sessionId], (current) =>
            current ? { ...current, session: snapshot.session } : current
          );
        }
        setQueuedTurns(snapshot.queue ?? []);
        if (typeof snapshot.serverTime === "number") {
          clockOffsetRef.current = snapshot.serverTime - Date.now();
        }
        if (snapshot.run) {
          const reconnecting = reconnectNoticeFrom(snapshot.run.reconnecting);
          setRunState({
            startedAt: snapshot.run.startedAt,
            runId: snapshot.run.id,
            ...(snapshot.run.firstResponseAt
              ? { firstResponseAt: snapshot.run.firstResponseAt }
              : {}),
            ...(snapshot.run.endedAt ? { endedAt: snapshot.run.endedAt } : {}),
            ...(snapshot.run.usage ? { usage: snapshot.run.usage } : {}),
            status: snapshot.run.status,
            ...(snapshot.run.reason ? { reason: snapshot.run.reason } : {}),
            ...(reconnecting ? { reconnecting } : {})
          });
        } else if (snapshot.session?.status && snapshot.session.status !== "idle") {
          setRunState({
            startedAt: snapshot.session.updatedAt,
            endedAt: snapshot.session.updatedAt,
            status: snapshot.session.status
          });
        } else {
          setRunState(null);
        }
        setEvents((current) =>
          (snapshot.approvals ?? []).reduce(
            (items, approval) =>
              upsert(items, `approval-${approval.id}`, {
                kind: "approval",
                text: approval.command,
                data: {
                  ...(approval.payload ?? {}),
                  approvalId: approval.id,
                  command: approval.command,
                  status: "pending"
                },
                providerId: providerIdRef.current,
                createdAt: approval.createdAt
              }),
            current
          )
        );
        if (snapshot.replayTruncated) {
          recordCursor(event.requestId, event.seq);
          setSendNotice("实时事件较多，已从持久记录恢复最新状态");
        }
        void qc.invalidateQueries({ queryKey: ["session", sessionId] });
        return;
      }

      recordCursor(event.requestId, event.seq);
      if (event.type === "queue.updated") {
        setQueuedTurns(Array.isArray(payload.items) ? payload.items : []);
        return;
      }
      if (event.type === "approval.resolved") {
        setEvents((current) =>
          current.map((item) =>
            item.id === `approval-${payload.approvalId}`
              ? {
                  ...item,
                  text:
                    payload.status === "declined"
                      ? "已拒绝该命令"
                      : payload.status === "cancelled"
                        ? "确认已取消"
                        : "已允许该命令",
                  data: { ...item.data, ...payload }
                }
              : item
          )
        );
        return;
      }
      if (event.type === "user.message") {
        setEvents((current) =>
          upsert(current, String(payload.id ?? `user-${event.requestId}`), {
            kind: "user",
            text: String(payload.message ?? ""),
            providerId: payload.providerId ?? providerIdRef.current,
            createdAt: payload.createdAt ?? Date.now()
          })
        );
        void qc.invalidateQueries({ queryKey: ["sessions", projectId] });
        return;
      }
      if (event.type === "run.reconnecting") {
        const reconnecting = reconnectNoticeFrom(payload);
        setRunState((current) =>
          patchTaskState(current, {
            status: "running",
            ...(typeof payload.startedAt === "number" ? { startedAt: payload.startedAt } : {}),
            ...(reconnecting ? { reconnecting } : {})
          })
        );
        return;
      }
      if (event.type === "run.started" || event.type === "turn.started") {
        setRunState((current) =>
          beginRunningTaskState(current, {
            ...(typeof payload.startedAt === "number" ? { startedAt: payload.startedAt } : {}),
            ...(typeof event.requestId === "string" ? { runId: event.requestId } : {})
          })
        );
        void qc.invalidateQueries({ queryKey: ["active-runs"] });
      } else if (event.type === "turn.completed") {
        setRunState((current) =>
          patchTaskState(current, {
            status: "completed",
            ...(typeof payload.startedAt === "number" ? { startedAt: payload.startedAt } : {}),
            ...(typeof payload.firstResponseAt === "number"
              ? { firstResponseAt: payload.firstResponseAt }
              : {}),
            endedAt: payload.endedAt ?? Date.now(),
            ...(payload.usage ? { usage: payload.usage } : {})
          })
        );
        refreshSession();
      } else if (event.type === "run.failed") {
        setRunState((current) =>
          patchTaskState(current, {
            status: "failed",
            ...(typeof payload.startedAt === "number" ? { startedAt: payload.startedAt } : {}),
            endedAt: payload.endedAt ?? Date.now(),
            ...(payload.usage ? { usage: payload.usage } : {}),
            ...(payload.reason || payload.message
              ? { reason: String(payload.reason ?? payload.message) }
              : {})
          })
        );
        refreshSession();
      } else if (event.type === "run.cancelled") {
        setRunState((current) =>
          patchTaskState(current, {
            status: "cancelled",
            ...(typeof payload.startedAt === "number" ? { startedAt: payload.startedAt } : {}),
            endedAt: payload.endedAt ?? Date.now(),
            ...(payload.reason ? { reason: String(payload.reason) } : {})
          })
        );
        refreshSession();
      } else if (event.type === "run.interrupted") {
        setRunState((current) =>
          patchTaskState(current, {
            status: "interrupted",
            ...(typeof payload.startedAt === "number" ? { startedAt: payload.startedAt } : {}),
            endedAt: payload.endedAt ?? Date.now(),
            ...(payload.reason ? { reason: String(payload.reason) } : {})
          })
        );
        refreshSession();
      } else if (
        [
          "reasoning.delta",
          "assistant.delta",
          "assistant.completed",
          "tool.started",
          "tool.output",
          "file.change",
          "approval.requested"
        ].includes(event.type)
      ) {
        setRunState((current) =>
          current
            ? patchTaskState(current, {
                status: "running",
                reconnecting: null,
                ...(!current.firstResponseAt
                  ? {
                      firstResponseAt:
                        typeof payload.firstResponseAt === "number"
                          ? payload.firstResponseAt
                          : Date.now() + clockOffsetRef.current
                    }
                  : {})
              })
            : current
        );
      }
      setEvents((current) => {
        const put = (id: string, next: Omit<TimelineItem, "id">) =>
          upsert(current, id, compactTimelineItem(next));
        if (event.type === "assistant.delta" || event.type === "assistant.completed") {
          const id = `assistant-${event.requestId}-${payload.itemId}`;
          const previous = current.find((item) => item.id === id);
          return put(id, {
            kind: "assistant",
            text: applyTextPatch(previous?.text ?? "", payload),
            providerId: providerIdRef.current,
            streaming: event.type !== "assistant.completed",
            createdAt: payload.createdAt ?? previous?.createdAt ?? Date.now()
          });
        }
        if (event.type === "reasoning.delta") {
          const id = `reasoning-${event.requestId}-${payload.itemId}`;
          const previous = current.find((item) => item.id === id);
          return put(id, {
            kind: "reasoning",
            text: applyTextPatch(previous?.text ?? "", payload),
            data: payload,
            providerId: providerIdRef.current,
            streaming: true
          });
        }
        if (event.type === "tool.started" || event.type === "tool.output") {
          const id = `tool-${event.requestId}-${payload.itemId}`;
          const previous = current.find((item) => item.id === id);
          const output = applyTextPatch(previous?.text ?? String(previous?.data?.output ?? ""), {
            text: payload.output,
            delta: payload.outputDelta
          });
          const rest = { ...(payload as Record<string, unknown>) };
          delete rest.outputDelta;
          return put(id, {
            kind: "tool",
            data: { ...previous?.data, ...rest, output },
            text: output,
            providerId: providerIdRef.current,
            streaming: event.type === "tool.started" || rest.status === "in_progress"
          });
        }
        if (event.type === "file.change")
          return put(`file-${event.requestId}-${payload.itemId}`, {
            kind: "file",
            data: payload,
            providerId: providerIdRef.current
          });
        if (event.type === "approval.requested")
          return upsert(current, `approval-${payload.approvalId}`, {
            kind: "approval",
            data: { ...payload, status: "pending" },
            text: payload.command,
            providerId: providerIdRef.current
          });
        if (event.type === "run.failed")
          return upsert(current, `error-${event.requestId}-run.failed`, {
            kind: "error",
            text: payload.message ?? payload.reason ?? "Codex 运行失败",
            providerId: providerIdRef.current,
            createdAt: Date.now()
          });
        return current;
      });
    };
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket.current = null;
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
        return;
      }
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, [sessionId, projectId, qc, reconnectNonce]);
  const activeProject = projects.data?.find((p) => p.id === projectId);
  const activeSession =
    (detail.data?.session?.id === sessionId && detail.data.session.projectId === projectId
      ? detail.data.session
      : null) ??
    sessions.data?.find((s) => s.id === sessionId && s.projectId === projectId) ??
    null;
  const sessionLoading = Boolean(sessionId) && detail.isPending;
  const selectedProvider = providers.data?.find((p) => p.id === providerId) ?? null;
  const loadOlderMessages = useCallback(async () => {
    const cursor = historyCursor;
    if (!sessionId || !hasOlderMessages || !cursor || historyLoadingRef.current) return;
    const requestId = ++historyRequestId.current;
    historyLoadingRef.current = true;
    stickToBottom.current = false;
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(SESSION_PAGE_SIZE),
        beforeCreatedAt: String(cursor.createdAt),
        beforeId: cursor.id
      });
      const older = await api<SessionDetailPage>(`/api/sessions/${sessionId}?${params}`);
      if (currentSessionId.current !== sessionId) return;
      const olderEvents = older.messages.filter(isVisibleTimelineMessage).map((message) => fromMessage(message));
      const container = chatScroll.current;
      if (container) {
        historyScrollSnapshot.current = {
          height: container.scrollHeight,
          top: container.scrollTop
        };
      }
      setEvents((current) => {
        const known = new Set(current.map((item) => item.id));
        const prepend = olderEvents.filter((item) => !known.has(item.id));
        if (!prepend.length) historyScrollSnapshot.current = null;
        return [...prepend, ...current];
      });
      setHistoryCursor(older.nextCursor);
      setHasOlderMessages(older.hasMore);
      historyExpanded.current = true;
    } catch (error) {
      if (currentSessionId.current === sessionId) {
        historyScrollSnapshot.current = null;
        setSendNotice(error instanceof Error ? error.message : "更早的历史加载失败");
      }
    } finally {
      if (historyRequestId.current === requestId) {
        historyLoadingRef.current = false;
        if (currentSessionId.current === sessionId) setHistoryLoading(false);
      }
    }
  }, [hasOlderMessages, historyCursor, sessionId]);
  const loadFullMessage = useCallback(async (item: TimelineItem) => {
    if (!item.messageId) return;
    try {
      const message = await api<Message>(`/api/messages/${item.messageId}`);
      const full = fromMessage(message, { preview: false });
      setEvents((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, ...full, id: entry.id } : entry))
      );
    } catch (error) {
      setSendNotice(error instanceof Error ? error.message : "完整内容加载失败");
    }
  }, []);
  useEffect(() => {
    if (
      !providers.data ||
      (providerId && providers.data.some((provider) => provider.id === providerId))
    )
      return;
    setProviderId(
      providers.data.find((provider) => provider.isDefault)?.id ?? providers.data[0]?.id ?? ""
    );
  }, [providers.data, providerId]);
  const pendingApprovals = useMemo(
    () =>
      events.filter(
        (item) => item.kind === "approval" && (!item.data?.status || item.data.status === "pending")
      ),
    [events]
  );
  const blockReason = sendBlockReason({
    hasSession: Boolean(activeSession),
    hasProvider: Boolean(providerId),
    hasContent: Boolean(input.trim() || attachments.length),
    sending
  });
  const approvalNotice = approvalSummary(pendingApprovals.length);
  const contextEstimate = formatContextEstimate(input, attachments);
  const extraSlashCommands = useMemo<SlashCommand[]>(
    () =>
      (templates.data ?? [])
        .filter((item) => item.command)
        .map((item) => ({
          name: item.command as string,
          title: item.name,
          prompt: item.content
        })),
    [templates.data]
  );
  const lastAssistantText =
    [...events].reverse().find((item) => item.kind === "assistant")?.text ?? "";
  const availableModels = useMemo(() => selectedProvider?.models ?? [], [selectedProvider?.models]);
  useEffect(() => {
    setModel((current) =>
      current && availableModels.includes(current)
        ? current
        : (selectedProvider?.model ?? availableModels[0] ?? "")
    );
  }, [availableModels, providerId, selectedProvider?.model]);
  const providerNames = useMemo(
    () => new Map(providers.data?.map((p) => [p.id, p.name]) ?? []),
    [providers.data]
  );
  const startSession = useMutation({
    mutationFn: async (sourceId: string | null) => {
      if (sourceId) {
        const source = (sessions.data ?? []).find((session) => session.id === sourceId);
        return api<Session>(`/api/sessions/${sourceId}/continue`, {
          method: "POST",
          body: JSON.stringify({
            ...(providerId ? { providerId } : {}),
            ...(source?.title ? { title: source.title } : {})
          })
        });
      }
      return api<Session>(`/api/projects/${projectId}/sessions`, {
        method: "POST",
        body: JSON.stringify({
          providerId: providerId || activeProject?.providerId || providers.data?.[0]?.id || null
        })
      });
    },
    onSuccess: (s) => {
      qc.setQueriesData<Session[]>({ queryKey: ["sessions", projectId] }, (current) => [
        s,
        ...(current ?? []).filter((session) => session.id !== s.id)
      ]);
      openWorkspace(s.projectId || projectId, s.id, false, "chat");
      if (s.providerId) setProviderId(s.providerId);
      setNewSessionOpen(false);
      void qc.invalidateQueries({ queryKey: ["sessions", projectId] });
    },
    onError: (error) => {
      window.alert(error instanceof Error ? error.message : "新建对话失败");
    }
  });
  const beginNewSession = () => {
    const history = listHistoricalSessions(projectSessions);
    if (!history.length) startSession.mutate(null);
    else setNewSessionOpen(true);
  };
  const changeWorkspaceView = (view: WorkspaceView) => {
    setWorkspaceView(view);
  };
  const runPaletteAction = (action: PaletteAction) => {
    if (action.type === "new-session") {
      beginNewSession();
      return;
    }
    if (action.type === "new-project") {
      setNewProject(true);
      return;
    }
    if (action.type === "open-view") {
      changeWorkspaceView(action.view);
      return;
    }
    if (action.type === "open-settings") {
      navigate(settingsPath());
      return;
    }
    if (action.type === "open-providers") {
      setProviderManager(true);
      return;
    }
    if (action.type === "open-running-center") {
      setRunningCenterOpen(true);
      return;
    }
    if (action.type === "open-tasks") {
      setTaskBoardOpen(true);
      return;
    }
    if (action.type === "open-knowledge") {
      setKnowledgeOpen(true);
      return;
    }
    if (action.type === "open-skills") {
      setSkillsOpen(true);
      return;
    }
    if (action.type === "open-schedules") {
      setScheduleOpen(true);
      return;
    }
    if (action.type === "open-approvals") {
      setApprovalOpen(true);
      return;
    }
    if (action.type === "toggle-theme") {
      setTheme(resolvedTheme === "dark" ? "light" : "dark");
      return;
    }
    if (action.type === "refresh") {
      void qc.invalidateQueries();
      return;
    }
    if (action.type === "toggle-sidebar") {
      if (isMobile) setSidebar((value) => !value);
      else setSidebarCollapsed((value) => !value);
      return;
    }
    if (action.type === "goto-line") {
      changeWorkspaceView("files");
      setEditorCommand("goto-line");
      return;
    }
    if (action.type === "toggle-outline") {
      changeWorkspaceView("files");
      setEditorCommand("toggle-outline");
      return;
    }
    if (action.type === "enhance-prompt") {
      changeWorkspaceView("chat");
      setEnhanceNonce((value) => value + 1);
      return;
    }
    if (action.type === "project") {
      openWorkspace(action.projectId);
      return;
    }
    if (action.type === "session") {
      openWorkspace(action.projectId, action.sessionId, false, "chat");
      return;
    }
    if (action.type === "message") {
      openWorkspace(action.projectId, action.sessionId, false, "chat");
      setHighlightMessageId(action.messageId);
      setMessageHits(
        action.hits ?? [
          { projectId: action.projectId, sessionId: action.sessionId, messageId: action.messageId }
        ]
      );
      return;
    }
    if (action.type === "file") {
      openWorkspace(action.projectId, sessionId || "", false, "files");
      setOpenFileRequest({ path: action.path, line: action.line });
      return;
    }
    if (action.type === "git-commit") {
      openWorkspace(action.projectId, sessionId || "", false, "git");
      setFocusCommit(action.hash);
      return;
    }
    if (action.type === "git-branch") {
      openWorkspace(action.projectId, sessionId || "", false, "git");
    }
  };
  const deleteSession = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/sessions/${id}`, { method: "DELETE" }),
    onSuccess: (_result, id) => {
      const remaining = (sessions.data ?? []).filter((session) => session.id !== id);
      qc.setQueriesData<Session[]>({ queryKey: ["sessions", projectId] }, (current) =>
        (current ?? []).filter((session) => session.id !== id)
      );
      if (sessionId === id) openWorkspace(projectId, remaining[0]?.id ?? "", true);
      void qc.invalidateQueries({ queryKey: ["sessions", projectId] });
      void qc.removeQueries({ queryKey: ["session", id] });
    }
  });
  const updateSession = useMutation({
    mutationFn: ({
      id,
      changes
    }: {
      id: string;
      changes: {
        title?: string;
        pinned?: boolean;
        archived?: boolean;
        color?: string | null;
        icon?: string | null;
        tags?: string[];
      };
    }) =>
      api<Session>(`/api/sessions/${id}`, {
        method: "PUT",
        body: JSON.stringify(changes)
      }),
    onSuccess: (updated) => {
      qc.setQueriesData<Session[]>({ queryKey: ["sessions", updated.projectId] }, (current) =>
        current?.map((session) => (session.id === updated.id ? updated : session))
      );
      qc.setQueryData<SessionDetailPage>(["session", updated.id], (current) =>
        current ? { ...current, session: updated } : current
      );
      void qc.invalidateQueries({ queryKey: ["sessions", updated.projectId] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Session 更新失败";
      setSendNotice(message);
      toast.error(message);
    }
  });
  const updateProject = useMutation({
    mutationFn: ({
      id,
      changes
    }: {
      id: string;
      changes: { name?: string; pinned?: boolean; opened?: boolean };
    }) =>
      api<Project>(`/api/projects/${id}`, {
        method: "PUT",
        body: JSON.stringify(changes)
      }),
    onSuccess: (updated) => {
      if (!updated) return;
      qc.setQueryData<Project[]>(["projects"], (current) =>
        current?.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "工程更新失败";
      toast.error(message);
    }
  });
  const deleteProject = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: (_result, id) => {
      const remaining = (projects.data ?? []).filter((project) => project.id !== id);
      qc.setQueryData<Project[]>(["projects"], remaining);
      if (projectId === id) openWorkspace(remaining[0]?.id ?? "", "", true);
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.removeQueries({ queryKey: ["sessions", id] });
    },
    onError: (error) => {
      window.alert(error instanceof Error ? error.message : "删除项目失败");
    }
  });
  const addAttachments = async (
    files: Array<{
      name: string;
      type?: string;
      size: number;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>
  ) => {
    if (!files.length) return;
    try {
      const result = await collectComposerAttachments(attachments, files, createId);
      setAttachments(result.items);
      setAttachError(result.error ?? "");
      if (result.error) setSendNotice(result.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : "添加附件失败";
      setAttachError(message);
      setSendNotice(message);
    }
  };
  const composeTurnPayload = async (raw: string, files: ComposerAttachment[]) => {
    let message = expandSlashCommand(raw.trim(), extraSlashCommands, {
      projectName: activeProject?.name,
      sessionTitle: activeSession?.title
    });
    const mentions = extractMentions(raw);
    if (mentions.length && projectId) {
      const chunks: string[] = [];
      for (const filePath of mentions) {
        try {
          const file = await api<FilePreview>(
            `/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`
          );
          chunks.push(`<file path="${file.path}">\n${file.content.slice(0, 80_000)}\n</file>`);
        } catch {
          chunks.push(`<file path="${filePath}">无法读取该文件</file>`);
        }
      }
      message = message ? `${message}\n\n${chunks.join("\n\n")}` : chunks.join("\n\n");
    }
    const uploaded: Array<{
      name: string;
      path: string;
      kind: ComposerAttachment["kind"];
      text?: string;
    }> = [];
    if (files.length) {
      if (!projectId) throw new Error("请先选择工程");
      try {
        await api(`/api/projects/${projectId}/files`, {
          method: "POST",
          body: JSON.stringify({ path: ATTACHMENT_UPLOAD_DIR, type: "directory" })
        });
      } catch (error) {
        const notice = error instanceof Error ? error.message : String(error);
        if (!notice.includes("已存在")) throw error;
      }
      for (const file of files) {
        const path = attachmentUploadPath(file.name);
        const copy = new ArrayBuffer(file.bytes.byteLength);
        new Uint8Array(copy).set(file.bytes);
        await apiUpload(
          `/api/projects/${projectId}/files/upload?path=${encodeURIComponent(path)}&overwrite=true`,
          copy
        );
        uploaded.push({
          name: file.name,
          path,
          kind: file.kind,
          ...(file.text ? { text: file.text } : {})
        });
      }
      const prompt = buildAttachmentPrompt(uploaded);
      message = message ? `${message}\n\n${prompt}` : prompt;
    }
    if (!message.trim()) throw new Error("请输入消息或添加附件");
    return {
      message,
      displayMessage: raw.trim() || uploaded.map((item) => item.name).join("、"),
      attachments: uploaded.map(({ name, path, kind }) => ({ name, path, kind }))
    };
  };
  const send = () => {
    void submitMessage();
  };
  const submitMessage = async (overrideText?: string) => {
    const usingOverride = overrideText != null;
    const raw = (usingOverride ? overrideText : input).trim();
    const files = usingOverride ? [] : attachments;
    const reason = sendBlockReason({
      hasSession: Boolean(activeSession),
      hasProvider: Boolean(providerId),
      hasContent: Boolean(raw || files.length),
      sending
    });
    if (reason) {
      setSendNotice(reason);
      if (!providerId) setProviderManager(true);
      return;
    }
    if (!activeSession) return;
    if (
      shouldContinueWithProvider({
        sessionProviderId: activeSession.providerId,
        selectedProviderId: providerId,
        hasConversation: timelineHasConversation(events)
      })
    ) {
      setContinuation(selectedProvider);
      return;
    }
    setSending(true);
    try {
      const composed = usingOverride
        ? {
            message: raw,
            displayMessage: raw,
            attachments: [] as Array<{
              name: string;
              path: string;
              kind: ComposerAttachment["kind"];
            }>
          }
        : await composeTurnPayload(raw, files);
      if (isPlaceholderSessionTitle(activeSession.title)) {
        const title = titleFromFirstMessage(composed.displayMessage);
        qc.setQueriesData<Session[]>({ queryKey: ["sessions", projectId] }, (current) =>
          (current ?? []).map((session) =>
            session.id === sessionId ? { ...session, title } : session
          )
        );
        qc.setQueryData<SessionDetailPage>(["session", sessionId], (current) =>
          current ? { ...current, session: { ...current.session, title } } : current
        );
      }
      stickToBottom.current = true;
      const clientId = createId();
      const now = Date.now();
      const command = JSON.stringify({
        type: "turn.enqueue",
        clientId,
        projectId,
        sessionId,
        message: composed.message,
        displayMessage: composed.displayMessage,
        ...(composed.attachments.length ? { attachments: composed.attachments } : {}),
        providerId,
        ...(model ? { model } : {}),
        sandbox: workspaceSettings.sandbox,
        approvalPolicy: workspaceSettings.approvalPolicy,
        networkAccessEnabled: workspaceSettings.networkAccessEnabled,
        mode: workspaceSettings.executionMode
      });
      queuedCommands.current = [
        ...queuedCommands.current.filter((item) => item.id !== clientId),
        { id: clientId, sessionId, data: command, message: composed.displayMessage }
      ];
      persistOutboundCommands(queuedCommands.current);
      setQueuedTurns((current) => [
        ...current.filter((item) => item.id !== clientId),
        {
          id: clientId,
          sessionId,
          projectId,
          providerId,
          message: composed.message,
          options: {
            ...(model ? { model } : {}),
            sandbox: workspaceSettings.sandbox,
            approvalPolicy: workspaceSettings.approvalPolicy,
            networkAccessEnabled: workspaceSettings.networkAccessEnabled,
            mode: workspaceSettings.executionMode,
            displayMessage: composed.displayMessage,
            ...(composed.attachments.length ? { attachments: composed.attachments } : {})
          },
          createdAt: now,
          updatedAt: now
        }
      ]);
      if (socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(command);
        setSendNotice(
          runState?.status === "running" || pendingApprovals.length
            ? "已加入消息队列"
            : "正在启动任务"
        );
      } else {
        setSendNotice("连接正在恢复，连接成功后会自动发送");
        setConnection("reconnecting");
      }
      if (!usingOverride) {
        setInput("");
        setAttachments([]);
        setAttachError("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送失败";
      setSendNotice(message);
      setAttachError(message);
    } finally {
      setSending(false);
    }
  };
  const removeQueuedTurn = (queueId: string) => {
    const pending = queuedCommands.current.find((command) => command.id === queueId);
    if (pending) {
      queuedCommands.current = [
        ...queuedCommands.current.filter((command) => command.id !== queueId),
        {
          id: queueId,
          sessionId,
          data: JSON.stringify({ type: "queue.remove", sessionId, queueId }),
          message: ""
        }
      ];
      persistOutboundCommands(queuedCommands.current);
      setQueuedTurns((current) => current.filter((item) => item.id !== queueId));
      if (socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(queuedCommands.current.find((command) => command.id === queueId)!.data);
      }
      return;
    }
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setSendNotice("连接恢复后再删除服务端队列消息");
      return;
    }
    socket.current.send(JSON.stringify({ type: "queue.remove", sessionId, queueId }));
  };
  const updateQueuedTurn = async (queueId: string, message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const currentItem = queuedTurns.find((item) => item.id === queueId);
    const existingAttachments = queuedAttachmentMeta(currentItem?.options);
    let composedMessage = trimmed;
    try {
      const composed = await composeTurnPayload(trimmed, []);
      composedMessage = existingAttachments.length
        ? `${composed.message}\n\n${buildAttachmentPrompt(existingAttachments)}`
        : composed.message;
    } catch (error) {
      setSendNotice(error instanceof Error ? error.message : "更新队列失败");
      return;
    }
    const pending = queuedCommands.current.find((command) => command.id === queueId);
    if (pending) {
      const parsed = JSON.parse(pending.data);
      pending.message = trimmed;
      pending.data = JSON.stringify({
        ...parsed,
        message: composedMessage,
        displayMessage: trimmed
      });
      persistOutboundCommands(queuedCommands.current);
      setQueuedTurns((current) =>
        current.map((item) =>
          item.id === queueId
            ? {
                ...item,
                message: composedMessage,
                options: { ...item.options, displayMessage: trimmed },
                updatedAt: Date.now()
              }
            : item
        )
      );
      if (socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(
          JSON.stringify({
            type: "queue.update",
            sessionId,
            queueId,
            message: composedMessage,
            displayMessage: trimmed
          })
        );
      }
    } else if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(
        JSON.stringify({
          type: "queue.update",
          sessionId,
          queueId,
          message: composedMessage,
          displayMessage: trimmed
        })
      );
      setQueuedTurns((current) =>
        current.map((item) =>
          item.id === queueId
            ? {
                ...item,
                message: composedMessage,
                options: { ...item.options, displayMessage: trimmed },
                updatedAt: Date.now()
              }
            : item
        )
      );
    } else {
      setSendNotice("连接恢复后再编辑服务端队列消息");
      return;
    }
    setEditingQueueId("");
    setQueueDraft("");
  };
  const moveQueuedTurn = (queueId: string, direction: "up" | "down") => {
    setQueuedTurns((current) => {
      const index = current.findIndex((item) => item.id === queueId);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      return next;
    });
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setSendNotice("连接恢复后再调整队列顺序");
      return;
    }
    socket.current.send(JSON.stringify({ type: "queue.move", sessionId, queueId, direction }));
  };
  const startNextQueuedTurn = () => {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setSendNotice("连接恢复后再开始下一条消息");
      return;
    }
    socket.current.send(JSON.stringify({ type: "queue.start-next", sessionId }));
  };
  const beginRenameSession = (session: Session) => {
    setRenamingSessionId(session.id);
    setRenameDraft(session.title);
  };
  const cancelSessionLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const startSessionLongPress = (session: Session) => {
    cancelSessionLongPress();
    longPressTimer.current = window.setTimeout(() => {
      beginRenameSession(session);
      longPressTimer.current = null;
    }, 550);
  };
  const forkSessionFrom = async (messageId?: string, sourceId = sessionId) => {
    if (!sourceId) return;
    try {
      const target = await api<Session>(`/api/sessions/${sourceId}/fork`, {
        method: "POST",
        body: JSON.stringify(messageId ? { messageId } : {})
      });
      await qc.invalidateQueries({ queryKey: ["sessions", projectId] });
      openWorkspace(target.projectId || projectId, target.id, false, "chat");
      toast.success("已创建分叉会话");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分叉失败");
    }
  };
  const reloadSession = () => {
    void detail.refetch();
    setReconnectNonce((value) => value + 1);
    toast.message("正在重新加载会话");
  };
  const clearRunRecords = async () => {
    if (!sessionId) return;
    if (!window.confirm("清理当前会话的运行记录、工具输出和推理？用户与助手消息会保留。")) return;
    try {
      await api(`/api/sessions/${sessionId}/clear-runs`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["session", sessionId] });
      setEvents((current) =>
        current.filter(
          (item) =>
            item.kind === "user" ||
            item.kind === "assistant" ||
            item.kind === "approval" ||
            item.kind === "system"
        )
      );
      toast.success("已清理运行记录");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清理失败");
    }
  };
  const saveSessionTitle = (id: string) => {
    const title = renameDraft.trim();
    setRenamingSessionId("");
    setRenameDraft("");
    if (!title) return;
    const current = (sessions.data ?? []).find((session) => session.id === id);
    if (current?.title === title) return;
    updateSession.mutate({ id, changes: { title } });
  };
  const beginRenameProject = (project: Project) => {
    setRenamingProjectId(project.id);
    setProjectRenameDraft(project.name);
  };
  const saveProjectName = (id: string) => {
    const name = projectRenameDraft.trim();
    setRenamingProjectId("");
    setProjectRenameDraft("");
    if (!name) return;
    const current = (projects.data ?? []).find((project) => project.id === id);
    if (current?.name === name) return;
    updateProject.mutate({ id, changes: { name } });
  };
  const quoteToInput = (text: string) => {
    const quoted = quoteMarkdown(text);
    if (!quoted) return;
    setInput((current) =>
      current.trim() ? `${current.trim()}\n\n${quoted}\n\n` : `${quoted}\n\n`
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const toggleStarMessage = async (messageId: string) => {
    const starred = !starredIds.includes(messageId);
    try {
      await api(`/api/messages/${messageId}/star`, {
        method: "PUT",
        body: JSON.stringify({ starred })
      });
      setStarredIds((current) =>
        starred ? [...current, messageId] : current.filter((id) => id !== messageId)
      );
      toast.success(starred ? "已收藏消息" : "已取消收藏");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "收藏失败");
    }
  };
  const saveMessageNote = async (text: string, title?: string) => {
    if (!projectId || !text.trim()) return;
    try {
      await api(`/api/projects/${projectId}/notes`, {
        method: "POST",
        body: JSON.stringify({
          kind: "note",
          title: (title ?? text.trim().slice(0, 40) ?? "消息笔记").slice(0, 80),
          content: text.trim().slice(0, 20_000)
        })
      });
      toast.success("已保存到项目笔记");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存笔记失败");
    }
  };
  const summarizeMessage = async (text: string) => {
    const summary = summarizeMessageText(text);
    if (!summary.content) {
      toast.message("这条消息没有可摘要的内容");
      return;
    }
    await saveMessageNote(summary.content, summary.title);
  };
  const copyMessageLink = async (id: string) => {
    const url = `${window.location.origin}${workspacePath(projectId, sessionId)}#${encodeURIComponent(id)}`;
    const copied = await copyTextToClipboard(url);
    if (copied) {
      window.history.replaceState(null, "", `#${encodeURIComponent(id)}`);
      toast.success("已复制消息链接");
    } else toast.error("复制失败");
  };
  const jumpMessageHit = (offset: number) => {
    if (!messageHits.length) return;
    const current = Math.max(
      0,
      messageHits.findIndex((hit) => hit.messageId === highlightMessageId)
    );
    const next = messageHits[(current + offset + messageHits.length) % messageHits.length];
    if (!next) return;
    openWorkspace(next.projectId, next.sessionId, false, "chat");
    setHighlightMessageId(next.messageId);
  };
  const createFileFromSnippet = async () => {
    if (!createFile || !projectId) return;
    const path = createFilePath.trim();
    if (!path) return;
    try {
      await api(`/api/projects/${projectId}/files`, {
        method: "POST",
        body: JSON.stringify({ path, type: "file", content: createFile.content })
      });
      setCreateFile(null);
      setWorkspaceView("files");
      setOpenFileRequest({ path, line: null });
      toast.success("已创建文件", { description: path });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建文件失败");
    }
  };
  const archiveSession = (session: Session, archived: boolean) => {
    if (archived) setShowArchived(true);
    const archivedAt = archived ? Date.now() : null;
    qc.setQueryData<Session[]>(["sessions", projectId], (current) =>
      (current ?? []).map((item) => (item.id === session.id ? { ...item, archivedAt } : item))
    );
    void updateSession
      .mutateAsync({ id: session.id, changes: { archived } })
      .then((updated) => {
        qc.setQueryData<Session[]>(["sessions", projectId], (current) =>
          (current ?? []).map((item) =>
            item.id === updated.id
              ? { ...item, ...updated, archivedAt: updated.archivedAt ?? archivedAt }
              : item
          )
        );
        toast.success(archived ? `已归档「${session.title}」` : `已恢复「${session.title}」`);
      })
      .catch(() => {
        void qc.invalidateQueries({ queryKey: ["sessions", projectId] });
      });
  };
  const exportSession = (
    id: string,
    format: "markdown" | "json",
    options?: { reasoning?: boolean; tools?: boolean }
  ) => {
    if (!options) {
      setExportOptions({ id, format, reasoning: true, tools: true });
      return;
    }
    const link = document.createElement("a");
    link.href = `/api/sessions/${id}/export?format=${format}&reasoning=${options.reasoning !== false}&tools=${options.tools !== false}`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  const runElapsed =
    runState && runState.status !== "running"
      ? formatDuration((runState.endedAt ?? Date.now()) - runState.startedAt)
      : "";
  const runFirstResponse = runState?.firstResponseAt
    ? formatDuration(runState.firstResponseAt - runState.startedAt)
    : "";
  const runTokenCount =
    runState?.usage?.total_tokens ??
    runState?.usage?.totalTokens ??
    ((runState?.usage?.input_tokens ?? runState?.usage?.inputTokens ?? 0) +
      (runState?.usage?.output_tokens ?? runState?.usage?.outputTokens ?? 0) ||
      undefined);
  const runTokenLabel = formatTokens(runTokenCount);
  const saveWorkspaceSettings = async (next: WorkspaceSettings) => {
    const previous = qc.getQueryData(["settings"]);
    qc.setQueryData(["settings"], next);
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(next) });
    } catch (error) {
      qc.setQueryData(["settings"], previous);
      toast.error(error instanceof Error ? error.message : "保存设置失败");
      throw error;
    }
  };
  const cancelTurn = () => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(
        JSON.stringify({
          type: "turn.cancel",
          sessionId,
          turnId: "active"
        })
      );
    } else {
      setSendNotice("连接恢复后再停止任务");
    }
  };
  return (
    <div
      className="workspace-shell flex min-h-0 flex-1 overflow-hidden bg-background text-foreground"
      style={{ ["--ui-font-size" as string]: `${workspaceSettings.uiFontSize}px` }}
    >
      <WorkspaceSidebar
        sidebar={sidebar}
        isMobile={isMobile}
        sidebarCollapsed={sidebarCollapsed}
        sidebarWidth={sidebarWidth}
        setSidebar={setSidebar}
        setSidebarCollapsed={setSidebarCollapsed}
        setSidebarWidth={setSidebarWidth}
        beginNewSession={beginNewSession}
        startSessionPending={startSession.isPending}
        projectId={projectId}
        setPaletteOpen={setPaletteOpen}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
        archivedSessions={archivedSessions}
        setNewProject={setNewProject}
        projectList={projectList}
        projectSort={projectSort}
        setProjectSort={setProjectSort}
        openWorkspace={openWorkspace}
        renamingProjectId={renamingProjectId}
        setRenamingProjectId={setRenamingProjectId}
        projectRenameDraft={projectRenameDraft}
        setProjectRenameDraft={setProjectRenameDraft}
        saveProjectName={saveProjectName}
        beginRenameProject={beginRenameProject}
        updateProject={updateProject}
        deleteProject={deleteProject}
        projectSessions={projectSessions}
        sessionGroups={sessionGroups}
        sessionId={sessionId}
        sessionLoading={sessionLoading}
        providerNames={providerNames}
        sessionsPending={sessions.isPending}
        renamingSessionId={renamingSessionId}
        setRenamingSessionId={setRenamingSessionId}
        renameDraft={renameDraft}
        setRenameDraft={setRenameDraft}
        saveSessionTitle={saveSessionTitle}
        beginRenameSession={beginRenameSession}
        startSessionLongPress={startSessionLongPress}
        cancelSessionLongPress={cancelSessionLongPress}
        forkSessionFrom={forkSessionFrom}
        updateSession={updateSession}
        archiveSession={archiveSession}
        exportSession={exportSession}
        deleteSession={deleteSession}
        setSendNotice={setSendNotice}
        activeRunsCount={activeRuns.data?.length ?? 0}
        pendingApprovalCount={pendingApprovalQuery.data?.length ?? pendingApprovals.length}
        connection={connection}
        setTaskBoardOpen={setTaskBoardOpen}
        setKnowledgeOpen={setKnowledgeOpen}
        setSkillsOpen={setSkillsOpen}
        setScheduleOpen={setScheduleOpen}
        setRunningCenterOpen={setRunningCenterOpen}
        setApprovalOpen={setApprovalOpen}
        setProviderManager={setProviderManager}
        setSettingsOpen={(open) => {
          if (open) navigate(settingsPath());
        }}
        providersCount={providers.data?.length ?? 0}
        host={runtime.data?.host}
      />
      <main className="workspace-main relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {activeProject ? (
          <>
            <WorkspaceHeader
              sidebar={sidebar}
              isMobile={isMobile}
              setSidebar={setSidebar}
              activeProject={activeProject}
              activeSession={activeSession ?? undefined}
              renamingSessionId={renamingSessionId}
              setRenamingSessionId={setRenamingSessionId}
              renameDraft={renameDraft}
              setRenameDraft={setRenameDraft}
              saveSessionTitle={saveSessionTitle}
              beginRenameSession={beginRenameSession}
              runState={runState}
              selectedProvider={selectedProvider ?? undefined}
              runtimeCodexHome={runtime.data?.defaultCodexHome}
              runElapsed={runElapsed}
              runFirstResponse={runFirstResponse}
              runTokenLabel={runTokenLabel}
              workspaceView={workspaceView}
              changeWorkspaceView={changeWorkspaceView}
              dirtyCount={dirtyCount}
              gitCount={gitCount}
              forkSessionFrom={forkSessionFrom}
              reloadSession={reloadSession}
              clearRunRecords={clearRunRecords}
              updateSession={updateSession}
              archiveSession={archiveSession}
              exportSession={exportSession}
              deleteSession={deleteSession}
              setSendNotice={setSendNotice}
            />
            <WorkspaceTimeline
              workspaceView={workspaceView}
              messageHits={messageHits}
              highlightMessageId={highlightMessageId}
              jumpMessageHit={jumpMessageHit}
              setMessageHits={setMessageHits}
              events={events}
              setHighlightMessageId={setHighlightMessageId}
              chatScroll={chatScroll}
              stickToBottom={stickToBottom}
              loadOlderMessages={loadOlderMessages}
              hasOlderMessages={hasOlderMessages}
              historyLoading={historyLoading}
              activeSession={activeSession ?? undefined}
              projectPath={activeProject?.realPath}
              sessionLoading={sessionLoading}
              detailError={detail.isError}
              refetchDetail={() => void detail.refetch()}
              workspaceSettings={workspaceSettings}
              providerNames={providerNames}
              forkSessionFrom={forkSessionFrom}
              setWorkspaceView={setWorkspaceView}
              setOpenFileRequest={setOpenFileRequest}
              setInput={setInput}
              setAttachments={setAttachments}
              inputRef={inputRef}
              submitMessage={submitMessage}
              quoteToInput={quoteToInput}
              copyMessageLink={copyMessageLink}
              starredIds={starredIds}
              onStarMessage={(id) => void toggleStarMessage(id)}
              onSaveNote={(text) => void saveMessageNote(text)}
              onSummarize={(text) => void summarizeMessage(text)}
              setCreateFile={setCreateFile}
              setCreateFilePath={setCreateFilePath}
              socket={socket}
              sessionId={sessionId}
              setSendNotice={setSendNotice}
              setEvents={setEvents}
              beginNewSession={beginNewSession}
              startSessionPending={startSession.isPending}
              recentSessions={projectSessions.filter((session) => !session.archivedAt).slice(0, 12)}
              sessionsPending={sessions.isPending}
              onOpenSession={(id) => openWorkspace(projectId, id, false, "chat")}
              runState={runState}
              connection={connection}
              sendNotice={sendNotice}
              saveWorkspaceSettings={saveWorkspaceSettings}
              loadFullMessage={loadFullMessage}
            />
            <WorkspaceComposer
              workspaceView={workspaceView}
              activeSession={activeSession ?? undefined}
              dragActive={dragActive}
              setDragActive={setDragActive}
              addAttachments={addAttachments}
              queuedTurns={queuedTurns}
              runState={runState}
              editingQueueId={editingQueueId}
              queueDraft={queueDraft}
              setQueueDraft={setQueueDraft}
              setEditingQueueId={setEditingQueueId}
              updateQueuedTurn={updateQueuedTurn}
              removeQueuedTurn={removeQueuedTurn}
              moveQueuedTurn={moveQueuedTurn}
              startNextQueuedTurn={startNextQueuedTurn}
              selectedProvider={selectedProvider ?? undefined}
              mentionRange={mentionRange}
              slashOpen={slashOpen}
              extraSlashCommands={extraSlashCommands}
              input={input}
              setInput={setInput}
              inputRef={inputRef}
              mentionItems={mentionItems}
              setMentionRange={setMentionRange}
              setMentionItems={setMentionItems}
              setSlashOpen={setSlashOpen}
              attachments={attachments}
              setAttachments={setAttachments}
              attachError={attachError}
              attachInputRef={attachInputRef}
              projectId={projectId}
              providerId={providerId}
              setProviderId={setProviderId}
              providers={providers.data}
              connection={connection}
              reconnectAttempt={reconnectAttempts.current}
              runtimeCodexHome={runtime.data?.defaultCodexHome}
              workspaceSettings={workspaceSettings}
              approvalNotice={approvalNotice}
              pendingApprovalsCount={pendingApprovals.length}
              contextEstimate={contextEstimate}
              runtimeOptionsOpen={runtimeOptionsOpen}
              setRuntimeOptionsOpen={setRuntimeOptionsOpen}
              saveWorkspaceSettings={saveWorkspaceSettings}
              model={model}
              setModel={setModel}
              availableModels={availableModels}
              cancelTurn={cancelTurn}
              blockReason={blockReason}
              send={send}
              sendNotice={sendNotice}
              activeProject={activeProject}
              enhanceNonce={enhanceNonce}
            />
            {activeProject && (workspaceView === "files" || workspaceView === "git") && (
              <div className="min-h-0 flex-1 overflow-hidden">
                <ProjectFilesPanel
                  key={activeProject.id}
                  project={activeProject}
                  view={workspaceView}
                  onViewChange={setWorkspaceView}
                  openFileRequest={openFileRequest}
                  editorCommand={editorCommand}
                  onCommandHandled={() => setEditorCommand(null)}
                  focusCommit={focusCommit}
                  onDirtyCount={setDirtyCount}
                  onGitCount={setGitCount}
                />
              </div>
            )}
            {activeProject && workspaceView === "terminal" && (
              <div className="min-h-0 flex-1 overflow-hidden">
                <Suspense
                  fallback={
                    <div className="grid h-full place-items-center text-sm text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <LoaderCircle className="size-4 animate-spin" /> 正在加载终端
                      </span>
                    </div>
                  }
                >
                  <TerminalPanel project={activeProject} />
                </Suspense>
              </div>
            )}
          </>
        ) : (
          <>
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
                <h1 className="text-sm font-semibold tracking-tight">Codex Omni</h1>
                <p className="text-[11px] text-muted-foreground">打开工程后先查看文件</p>
              </div>
              <ThemeSwitch />
            </header>
            <div className="grid min-h-0 flex-1 place-items-center px-6">
              <div className="max-w-sm text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-card shadow-sm">
                  <FolderPlus className="size-6 text-muted-foreground" />
                </span>
                <h2 className="mt-4 font-semibold">打开第一个工程</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  选择服务器上的项目目录，即可开始远程编码。
                </p>
                <Button className="mt-5" onClick={() => setNewProject(true)}>
                  <FolderPlus className="size-4" />
                  打开工程
                </Button>
              </div>
            </div>
          </>
        )}
      </main>
      <NewSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        sessions={projectSessions}
        providerNames={providerNames}
        busy={startSession.isPending}
        onConfirm={(sourceId) => startSession.mutate(sourceId)}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        projectId={projectId || undefined}
        onRun={runPaletteAction}
      />
      <Dialog open={Boolean(createFile)} onOpenChange={(open) => !open && setCreateFile(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>在项目中创建文件</DialogTitle>
            <DialogDescription>把代码块保存为工程文件并在编辑器中打开。</DialogDescription>
          </DialogHeader>
          <Input
            value={createFilePath}
            onChange={(event) => setCreateFilePath(event.target.value)}
            placeholder="src/snippet.ts"
            aria-label="文件路径"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateFile(null)}>
              取消
            </Button>
            <Button type="button" onClick={() => void createFileFromSnippet()}>
              创建并打开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RunningCenterDialog
        open={runningCenterOpen}
        onOpenChange={setRunningCenterOpen}
        onOpenSession={(nextProjectId, nextSessionId) => {
          openWorkspace(nextProjectId, nextSessionId, false, "chat");
          if (isMobile) setSidebar(false);
        }}
      />
      <NewProjectDialog
        open={newProject}
        onOpenChange={setNewProject}
        providers={providers.data ?? []}
        onCreate={async (body) => {
          const p = await api<Project>("/api/projects", {
            method: "POST",
            body: JSON.stringify(body)
          });
          await qc.invalidateQueries({ queryKey: ["projects"] });
          openWorkspace(p.id, "", false, "chat");
        }}
      />
      <ProviderDialog
        open={providerManager}
        onOpenChange={setProviderManager}
        providers={providers.data ?? []}
        onSelect={(id) => setProviderId(id)}
        onDelete={async (id) => {
          const result = await api<{ ok: boolean }>(`/api/providers/${id}`, { method: "DELETE" });
          if (!result.ok) throw new Error("Provider 不存在或已删除");
          qc.setQueryData<Provider[]>(["providers"], (current) =>
            (current ?? []).filter((provider) => provider.id !== id)
          );
          const remaining = await qc.fetchQuery({
            queryKey: ["providers"],
            queryFn: () => api<Provider[]>("/api/providers")
          });
          if (providerId === id) setProviderId(remaining[0]?.id ?? "");
          await qc.invalidateQueries({ queryKey: ["projects"] });
        }}
        onSave={async (body) => {
          await api(body.id ? `/api/providers/${body.id}` : "/api/providers", {
            method: body.id ? "PUT" : "POST",
            body: JSON.stringify(body)
          });
          await qc.invalidateQueries({ queryKey: ["providers"] });
        }}
        onRefresh={async () => {
          await qc.invalidateQueries({ queryKey: ["providers"] });
        }}
      />
      <TaskBoardDialog
        open={taskBoardOpen}
        onOpenChange={setTaskBoardOpen}
        projectId={projectId}
        sessionId={sessionId}
        planText={lastAssistantText}
        onOpenSession={(id) => openWorkspace(projectId, id, false, "chat")}
      />
      <ProjectKnowledgeDialog
        open={knowledgeOpen}
        onOpenChange={setKnowledgeOpen}
        projectId={projectId}
      />
      <SkillsMcpDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
        projectId={projectId}
        providers={providers.data ?? []}
      />
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        projectId={projectId}
        sessionId={sessionId}
      />
      <ApprovalAuditDialog
        open={approvalOpen}
        onOpenChange={setApprovalOpen}
        projectId={projectId || undefined}
        sessionId={sessionId || undefined}
        onOpenSession={(nextProjectId, nextSessionId) => {
          openWorkspace(nextProjectId, nextSessionId, false, "chat");
          if (isMobile) setSidebar(false);
        }}
      />
      <Dialog
        open={Boolean(exportOptions)}
        onOpenChange={(open) => !open && setExportOptions(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>导出对话</DialogTitle>
            <DialogDescription>选择要包含的内容范围后下载。</DialogDescription>
          </DialogHeader>
          {exportOptions && (
            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between gap-3">
                包含推理
                <Switch
                  checked={exportOptions.reasoning}
                  onCheckedChange={(checked) =>
                    setExportOptions({ ...exportOptions, reasoning: checked })
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                包含工具输出和文件变更
                <Switch
                  checked={exportOptions.tools}
                  onCheckedChange={(checked) =>
                    setExportOptions({ ...exportOptions, tools: checked })
                  }
                />
              </label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setExportOptions(null)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!exportOptions) return;
                exportSession(exportOptions.id, exportOptions.format, {
                  reasoning: exportOptions.reasoning,
                  tools: exportOptions.tools
                });
                setExportOptions(null);
              }}
            >
              下载
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProviderContinuationDialog
        open={Boolean(continuation)}
        onOpenChange={(v) => !v && setContinuation(null)}
        source={activeSession}
        target={continuation}
        busy={false}
        onConfirm={async () => {
          if (!activeSession || !continuation) return;
          const target = await api<Session & { bootstrapPrompt: string }>(
            `/api/sessions/${activeSession.id}/continue`,
            { method: "POST", body: JSON.stringify({ providerId: continuation.id }) }
          );
          pendingContinuationSend.current = {
            sessionId: target.id,
            message: input.trim(),
            providerId: continuation.id
          };
          await qc.invalidateQueries({ queryKey: ["sessions", projectId] });
          openWorkspace(target.projectId || projectId, target.id, false, "chat");
          setProviderId(continuation.id);
          setContinuation(null);
        }}
      />
    </div>
  );
}
