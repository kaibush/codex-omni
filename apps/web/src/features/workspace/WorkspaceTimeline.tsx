import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject
} from "react";
import {
  CircleAlert,
  Clock3,
  LoaderCircle,
  MessageSquarePlus,
  MessageSquareText,
  Pin,
  TerminalSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCompactDateTime, isScrolledToBottom } from "@/lib/utils";
import type { Session, TimelineItem } from "@/types";
import { EventCard } from "./EventCard";
import { VirtualTimeline } from "./VirtualTimeline";
import { TimelineOutline } from "./TimelineOutline";
import { RunStatusBubble } from "./WorkspaceStatus";
import type { ConnectionState, RunState } from "./workspace-model";
import type { ComposerAttachment } from "./composer-attachments";
import { snippetFileName } from "./markdown-refs";
import type { WorkspaceSettings } from "./SettingsDialog";
import {
  displayTimelineEvents,
  isTimelineView,
  TIMELINE_VIEW_OPTIONS,
  type TimelineView
} from "@/lib/timeline";

function useAutoHide(timeoutMs = 1800) {
  const [visible, setVisible] = useState(true);
  const pinnedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const reveal = useCallback(() => {
    setVisible(true);
    clearTimer();
    if (pinnedRef.current) return;
    timerRef.current = setTimeout(() => setVisible(false), timeoutMs);
  }, [timeoutMs]);
  const pin = useCallback(() => {
    pinnedRef.current = true;
    clearTimer();
    setVisible(true);
  }, []);
  const unpin = useCallback(() => {
    pinnedRef.current = false;
    reveal();
  }, [reveal]);
  useEffect(() => {
    reveal();
    return clearTimer;
  }, [reveal]);
  return { visible, reveal, pin, unpin };
}

export function WorkspaceTimeline({
  workspaceView,
  messageHits,
  highlightMessageId,
  jumpMessageHit,
  setMessageHits,
  events,
  setHighlightMessageId,
  chatScroll,
  stickToBottom,
  loadOlderMessages,
  hasOlderMessages,
  historyLoading,
  activeSession,
  projectPath,
  sessionLoading,
  detailError,
  refetchDetail,
  workspaceSettings,
  providerNames,
  forkSessionFrom,
  setWorkspaceView,
  setOpenFileRequest,
  setInput,
  setAttachments,
  inputRef,
  submitMessage,
  quoteToInput,
  copyMessageLink,
  starredIds,
  onStarMessage,
  onSaveNote,
  onSummarize,
  setCreateFile,
  setCreateFilePath,
  socket,
  sessionId,
  setSendNotice,
  setEvents,
  beginNewSession,
  startSessionPending,
  recentSessions,
  sessionsPending,
  onOpenSession,
  runState,
  connection,
  sendNotice,
  saveWorkspaceSettings
}: {
  workspaceView: "chat" | "files" | "git" | "terminal";
  messageHits: Array<{ projectId: string; sessionId: string; messageId: string }>;
  highlightMessageId: string;
  jumpMessageHit: (offset: number) => void;
  setMessageHits: Dispatch<
    SetStateAction<Array<{ projectId: string; sessionId: string; messageId: string }>>
  >;
  events: TimelineItem[];
  setHighlightMessageId: (id: string) => void;
  chatScroll: RefObject<HTMLElement | null>;
  stickToBottom: { current: boolean };
  loadOlderMessages: () => void;
  hasOlderMessages: boolean;
  historyLoading: boolean;
  activeSession: Session | undefined;
  projectPath?: string | undefined;
  sessionLoading: boolean;
  detailError: boolean;
  refetchDetail: () => void;
  workspaceSettings: WorkspaceSettings;
  providerNames: Map<string, string>;
  forkSessionFrom: (messageId?: string, sourceId?: string) => void;
  setWorkspaceView: (view: "chat" | "files" | "git" | "terminal") => void;
  setOpenFileRequest: (value: { path: string; line: number | null } | null) => void;
  setInput: Dispatch<SetStateAction<string>>;
  setAttachments: Dispatch<SetStateAction<ComposerAttachment[]>>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  submitMessage: (text?: string) => void;
  quoteToInput: (text: string) => void;
  copyMessageLink: (id: string) => void;
  starredIds: string[];
  onStarMessage: (messageId: string) => void;
  onSaveNote: (text: string) => void;
  onSummarize: (text: string) => void;
  setCreateFile: (value: { content: string; language: string } | null) => void;
  setCreateFilePath: (value: string) => void;
  socket: { current: WebSocket | null };
  sessionId: string;
  setSendNotice: (value: string) => void;
  setEvents: Dispatch<SetStateAction<TimelineItem[]>>;
  beginNewSession: () => void;
  startSessionPending: boolean;
  recentSessions: Session[];
  sessionsPending: boolean;
  onOpenSession: (sessionId: string) => void;
  runState: RunState | null;
  connection: ConnectionState;
  sendNotice: string;
  saveWorkspaceSettings: (settings: WorkspaceSettings) => Promise<void>;
}) {
  const detail = { isError: detailError, refetch: refetchDetail };
  const timelineView: TimelineView = isTimelineView(workspaceSettings.timelineView)
    ? workspaceSettings.timelineView
    : "folded";
  // A project route has no active session. Ignore the previous session's
  // events during the route transition so they cannot mask the recent list.
  const displayEvents = useMemo(
    () => (sessionId ? displayTimelineEvents(events, timelineView) : []),
    [events, sessionId, timelineView]
  );
  const showReasoning = timelineView !== "folded" || workspaceSettings.showReasoning;
  const timelineItems = useMemo(
    () =>
      showReasoning ? displayEvents : displayEvents.filter((item) => item.kind !== "reasoning"),
    [displayEvents, showReasoning]
  );
  const outlineEvents = timelineItems;
  const latestSession = recentSessions[0];
  const viewToggle = useAutoHide();
  const onOpenFile = useCallback(
    (path: string, line: number | null) => {
      setWorkspaceView("files");
      setOpenFileRequest({ path, line });
    },
    [setOpenFileRequest, setWorkspaceView]
  );
  const onCreateFile = useCallback(
    (content: string, language: string) => {
      setCreateFile({ content, language });
      setCreateFilePath(snippetFileName(language));
    },
    [setCreateFile, setCreateFilePath]
  );
  const onReply = useCallback((text: string) => void submitMessage(text), [submitMessage]);
  const onOpenThread = useCallback(
    (threadId: string) => {
      const match = recentSessions.find((session) => session.threadId === threadId);
      if (!match) return false;
      onOpenSession(match.id);
      return true;
    },
    [onOpenSession, recentSessions]
  );
  const onApproval = useCallback(
    (requestId: string, decision: "accept" | "acceptForSession" | "decline") => {
      if (socket.current?.readyState !== WebSocket.OPEN) {
        setSendNotice("连接已断开，恢复连接后再提交确认");
        return;
      }
      socket.current.send(
        JSON.stringify({
          type: "approval.respond",
          sessionId,
          requestId,
          decision
        })
      );
      setEvents((current) =>
        current.map((event) =>
          event.id === `approval-${requestId}`
            ? {
                ...event,
                kind: "approval" as const,
                text:
                  decision === "decline"
                    ? "已拒绝该命令"
                    : decision === "acceptForSession"
                      ? "已允许本会话后续命令"
                      : "已允许本次命令",
                data: {
                  ...event.data,
                  status: decision === "decline" ? "declined" : "accepted"
                }
              }
            : event
        )
      );
    },
    [sessionId, setEvents, setSendNotice, socket]
  );
  return (
    <div
      className={`chat-pane relative min-h-0 min-w-0 flex-1 overflow-hidden overscroll-none ${workspaceView === "chat" ? "" : "hidden"}`}
    >
      {messageHits.length > 1 ? (
        <div className="message-hit-bar">
          <span>
            消息{" "}
            {Math.max(1, messageHits.findIndex((hit) => hit.messageId === highlightMessageId) + 1)}/
            {messageHits.length}
          </span>
          <button
            type="button"
            className="rounded-md px-1.5 py-0.5 hover:bg-muted"
            onClick={() => jumpMessageHit(-1)}
          >
            上一条
          </button>
          <button
            type="button"
            className="rounded-md px-1.5 py-0.5 hover:bg-muted"
            onClick={() => jumpMessageHit(1)}
          >
            下一条
          </button>
          <button
            type="button"
            className="rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
            onClick={() => setMessageHits([])}
          >
            关闭
          </button>
        </div>
      ) : null}
      <TimelineOutline
        items={outlineEvents}
        activeId={highlightMessageId}
        onJump={(id) => setHighlightMessageId(id)}
      />
      {sessionLoading && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/80 backdrop-blur-[2px]">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-lg">
            <LoaderCircle className="size-5 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">正在加载对话</p>
              <p className="mt-0.5 text-xs text-muted-foreground">正在恢复消息和运行记录</p>
            </div>
          </div>
        </div>
      )}
      {detail.isError && !sessionLoading && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/80 backdrop-blur-[2px]">
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-center shadow-lg">
            <CircleAlert className="size-5 text-red-500" />
            <div>
              <p className="text-sm font-medium text-foreground">对话加载失败</p>
              <p className="mt-0.5 text-xs text-muted-foreground">请检查网络后重试</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void detail.refetch()}>
              重新加载
            </Button>
          </div>
        </div>
      )}
      <section
        ref={chatScroll}
        onWheel={(event) => {
          // Mark the gesture before the browser emits its scroll event. This
          // prevents a same-frame message/run update from snapping the first
          // upward wheel tick back to the bottom.
          if (event.deltaY < 0) stickToBottom.current = false;
          viewToggle.reveal();
        }}
        onPointerMove={viewToggle.reveal}
        onPointerDown={viewToggle.reveal}
        onScroll={() => {
          const container = chatScroll.current;
          if (!container) return;
          // A mouse-wheel tick in Chrome can move less than 96px.  Treating
          // that whole range as "at bottom" makes the layout effect below
          // snap the first upward scroll back to the bottom.
          stickToBottom.current = isScrolledToBottom(container, 12);
          const overflow = container.scrollHeight - container.clientHeight;
          if (overflow > 48 && container.scrollTop < 72) void loadOlderMessages();
        }}
        className="chat-scroll absolute inset-0 min-w-0 overflow-x-hidden overflow-y-auto px-3 sm:px-5 lg:px-8"
      >
        <div className="chat-content-width mx-auto flex min-w-0 flex-col gap-2.5 py-3 sm:gap-3 sm:py-4">
          {sessionId ? (
            <div
              className={`timeline-view-float${viewToggle.visible ? " is-visible" : ""}`}
              onPointerEnter={viewToggle.pin}
              onPointerLeave={viewToggle.unpin}
            >
              <div className="timeline-view-toggle" role="group" aria-label="时间线显示">
                {TIMELINE_VIEW_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={timelineView === option.value ? "is-active" : undefined}
                    aria-pressed={timelineView === option.value}
                    title={option.hint}
                    onClick={() => {
                      if (option.value === timelineView) return;
                      void saveWorkspaceSettings({ ...workspaceSettings, timelineView: option.value });
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {historyLoading ? (
            <div className="timeline-history-loading" role="status">
              <LoaderCircle className="size-3.5 animate-spin" />
              正在加载更早的对话
            </div>
          ) : hasOlderMessages ? (
            <div className="flex justify-center pb-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void loadOlderMessages()}
                className="text-xs text-muted-foreground"
              >
                <Clock3 className="size-3.5" />
                加载更早的对话
              </Button>
            </div>
          ) : null}
          {activeSession?.parentSessionId && (
            <div className="rounded-xl border border-border bg-muted px-4 py-3 text-xs text-foreground">
              {activeSession.continuationMode === "fork"
                ? "此 Session 由消息分叉生成，来源 Session 保持可回看。"
                : "此 Session 由其他 Provider 续接生成，来源 Session 保持可回看。"}
            </div>
          )}
          {sessionLoading ? (
            <div className="min-h-[45dvh] sm:min-h-[55vh]" />
          ) : timelineItems.length ? (
            <VirtualTimeline
              key={timelineView}
              items={timelineItems}
              scrollRef={chatScroll}
              stickToBottom={stickToBottom}
              scrollToId={highlightMessageId || undefined}
              renderItem={(item) => (
                <EventCard
                  item={item}
                  highlighted={highlightMessageId === item.id}
                  defaultOpen={
                    timelineView === "expanded" ||
                    (item.kind !== "reasoning" &&
                      workspaceSettings.expandToolCalls &&
                      item.streaming !== false)
                  }
                  hidden={item.kind === "reasoning" && !showReasoning}
                  showProviderLabel={workspaceSettings.showProviderLabels}
                  providerName={item.providerId ? providerNames.get(item.providerId) : undefined}
                  projectId={activeSession?.projectId}
                  projectPath={projectPath}
                  onReply={onReply}
                  onOpenThread={onOpenThread}
                  onFork={item.kind === "user" ? () => void forkSessionFrom(item.id) : undefined}
                  onEdit={
                    item.kind === "user"
                      ? () => {
                          setInput(item.text ?? "");
                          setAttachments([]);
                          requestAnimationFrame(() => inputRef.current?.focus());
                        }
                      : undefined
                  }
                  onRetry={
                    item.kind === "user" ? () => void submitMessage(item.text ?? "") : undefined
                  }
                  onQuote={
                    item.kind === "user" || item.kind === "assistant"
                      ? () => quoteToInput(item.text ?? "")
                      : undefined
                  }
                  onCopyLink={() => void copyMessageLink(item.id)}
                  starred={item.messageId ? starredIds.includes(item.messageId) : false}
                  onStar={
                    item.messageId && (item.kind === "user" || item.kind === "assistant")
                      ? () => onStarMessage(item.messageId!)
                      : undefined
                  }
                  onSaveNote={
                    item.kind === "user" || item.kind === "assistant"
                      ? () => onSaveNote(item.text ?? "")
                      : undefined
                  }
                  onSummarize={
                    item.kind === "user" || item.kind === "assistant"
                      ? () => onSummarize(item.text ?? "")
                      : undefined
                  }
                  onCreateFile={onCreateFile}
                  onOpenFile={onOpenFile}
                  onApproval={onApproval}
                />
              )}
            />
          ) : !activeSession ? (
            <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-1 py-8 sm:py-12">
              <div className="text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-card shadow-sm">
                  <MessageSquareText className="size-6 text-muted-foreground" />
                </span>
                <h2 className="mt-4 font-semibold">选择对话</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sessionsPending
                    ? "正在读取这个工程的对话。"
                    : latestSession
                      ? "打开最近对话，或从下面的列表里选择。"
                      : "这个工程还没有对话，先新建一个。"}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  {latestSession ? (
                    <Button
                      onClick={() => onOpenSession(latestSession.id)}
                      disabled={startSessionPending}
                    >
                      <MessageSquareText className="size-4" />
                      打开最近对话
                    </Button>
                  ) : null}
                  <Button
                    variant={latestSession ? "outline" : "default"}
                    onClick={beginNewSession}
                    disabled={startSessionPending}
                  >
                    <MessageSquarePlus className="size-4" />
                    新建对话
                  </Button>
                </div>
              </div>
              {sessionsPending ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  正在读取对话
                </div>
              ) : recentSessions.length ? (
                <div className="space-y-2">
                  <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    最近对话
                  </p>
                  {recentSessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => onOpenSession(session.id)}
                      className="flex w-full items-start gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left transition hover:bg-muted"
                    >
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-background text-primary shadow-sm">
                        <MessageSquareText className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1">
                          {session.pinnedAt ? (
                            <Pin className="size-3 shrink-0 text-primary" />
                          ) : null}
                          <span className="truncate text-sm font-medium">{session.title}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {[
                            formatCompactDateTime(session.lastMessageAt ?? session.updatedAt),
                            session.providerId ? providerNames.get(session.providerId) : null
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid min-h-[45dvh] place-items-center px-4 text-center sm:min-h-[55vh]">
              <div>
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-card shadow-sm">
                  <TerminalSquare className="size-6 text-muted-foreground" />
                </span>
                <h2 className="mt-4 font-semibold">开始处理这个工程</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  询问代码、运行工具、编辑文件，事件会实时呈现在这里。
                </p>
              </div>
            </div>
          )}
          {sessionId && runState?.status === "running" && (
            <RunStatusBubble state={runState} connection={connection} notice={sendNotice} />
          )}
        </div>
      </section>
    </div>
  );
}
