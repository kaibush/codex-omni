import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  Cpu,
  FileText,
  Image,
  KeyRound,
  ListPlus,
  LoaderCircle,
  Paperclip,
  Send,
  Sparkles,
  ShieldQuestion,
  Square,
  WifiOff,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  filesFromClipboard,
  filesFromDataTransfer,
  formatBytes,
  queueDisplayMessage,
  type ComposerAttachment
} from "@/features/workspace/composer-attachments";
import {
  insertAt,
  mentionQuery,
  slashQuery,
  sortSlashCommands,
  SLASH_COMMANDS,
  type SlashCommand
} from "@/features/workspace/composer-mentions";
import type { FileSearchMatch } from "@/features/workspace/file-workspace";
import type { Project, Provider, QueuedTurn } from "@/types";
import { QueuedTurnsPanel } from "./QueuedTurnsPanel";
import { RunSummary, RuntimeOptionsPanel, sandboxMeta, StatusChip } from "./WorkspaceStatus";
import type { ConnectionState, RunState } from "./workspace-model";
import type { WorkspaceSettings } from "./SettingsDialog";
import { PromptEnhanceDialog } from "./PromptEnhanceDialog";

export function WorkspaceComposer({
  workspaceView,
  activeSession,
  dragActive,
  setDragActive,
  addAttachments,
  queuedTurns,
  runState,
  editingQueueId,
  queueDraft,
  setQueueDraft,
  setEditingQueueId,
  updateQueuedTurn,
  removeQueuedTurn,
  moveQueuedTurn,
  startNextQueuedTurn,
  selectedProvider,
  mentionRange,
  slashOpen,
  extraSlashCommands,
  input,
  setInput,
  inputRef,
  mentionItems,
  setMentionRange,
  setMentionItems,
  setSlashOpen,
  attachments,
  setAttachments,
  attachError,
  attachInputRef,
  projectId,
  providerId,
  setProviderId,
  providers,
  connection,
  reconnectAttempt,
  runtimeCodexHome,
  workspaceSettings,
  approvalNotice,
  pendingApprovalsCount,
  contextEstimate,
  runtimeOptionsOpen,
  setRuntimeOptionsOpen,
  saveWorkspaceSettings,
  model,
  setModel,
  availableModels,
  cancelTurn,
  blockReason,
  send,
  sendNotice,
  activeProject,
  enhanceNonce = 0
}: {
  workspaceView: "chat" | "files" | "git" | "terminal";
  activeSession: { id: string } | undefined;
  dragActive: boolean;
  setDragActive: Dispatch<SetStateAction<boolean>>;
  addAttachments: (
    files: Array<{
      name: string;
      type?: string;
      size: number;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>
  ) => void;
  queuedTurns: QueuedTurn[];
  runState: RunState | null;
  editingQueueId: string;
  queueDraft: string;
  setQueueDraft: Dispatch<SetStateAction<string>>;
  setEditingQueueId: Dispatch<SetStateAction<string>>;
  updateQueuedTurn: (id: string, message: string) => void;
  removeQueuedTurn: (id: string) => void;
  moveQueuedTurn: (id: string, direction: "up" | "down") => void;
  startNextQueuedTurn: () => void;
  selectedProvider: Provider | undefined;
  mentionRange: { start: number; query: string } | null;
  slashOpen: boolean;
  extraSlashCommands: SlashCommand[];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  mentionItems: FileSearchMatch[];
  setMentionRange: Dispatch<SetStateAction<{ start: number; query: string } | null>>;
  setMentionItems: Dispatch<SetStateAction<FileSearchMatch[]>>;
  setSlashOpen: Dispatch<SetStateAction<boolean>>;
  attachments: ComposerAttachment[];
  setAttachments: Dispatch<SetStateAction<ComposerAttachment[]>>;
  attachError: string;
  attachInputRef: RefObject<HTMLInputElement | null>;
  projectId: string;
  providerId: string;
  setProviderId: (id: string) => void;
  providers: Provider[] | undefined;
  connection: ConnectionState;
  reconnectAttempt: number;
  runtimeCodexHome: string | undefined;
  workspaceSettings: WorkspaceSettings;
  approvalNotice: string | null;
  pendingApprovalsCount: number;
  contextEstimate: string;
  runtimeOptionsOpen: boolean;
  setRuntimeOptionsOpen: Dispatch<SetStateAction<boolean>>;
  saveWorkspaceSettings: (settings: WorkspaceSettings) => Promise<void>;
  model: string;
  setModel: (value: string) => void;
  availableModels: string[];
  cancelTurn: () => void;
  blockReason: string | null;
  send: () => void;
  sendNotice: string;
  activeProject: Project | undefined;
  enhanceNonce?: number;
}) {
  const pendingApprovals = { length: pendingApprovalsCount };
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhanceOriginal, setEnhanceOriginal] = useState("");
  const [enhanceText, setEnhanceText] = useState("");
  const [enhanceError, setEnhanceError] = useState("");
  const [enhanceModel, setEnhanceModel] = useState("");
  const openEnhance = (source = input) => {
    const text = source.trim();
    if (!text) {
      setEnhanceError("请先输入要强化的提示词");
      setEnhanceOpen(true);
      return;
    }
    if (!selectedProvider?.id) {
      setEnhanceError("请先选择供应商");
      setEnhanceOpen(true);
      return;
    }
    setEnhanceOpen(true);
    setEnhanceOriginal(text);
    setEnhanceText("");
    setEnhanceError("");
    setEnhanceModel(model || selectedProvider.model || "");
  };
  const runEnhance = async () => {
    const text = enhanceOriginal.trim();
    if (!text || !selectedProvider?.id) return;
    setEnhanceBusy(true);
    setEnhanceError("");
    try {
      const result = await api<{ text: string; model: string }>(
        `/api/providers/${selectedProvider.id}/enhance`,
        {
          method: "POST",
          body: JSON.stringify({ text, model: model || selectedProvider.model || undefined })
        }
      );
      setEnhanceText(result.text);
      setEnhanceModel(result.model);
    } catch (error) {
      setEnhanceError(error instanceof Error ? error.message : "强化失败");
    } finally {
      setEnhanceBusy(false);
    }
  };
  useEffect(() => {
    if (!enhanceNonce) return;
    openEnhance();
  }, [enhanceNonce]);
  const sandbox = sandboxMeta(workspaceSettings.sandbox);
  const SandboxIcon = sandbox.icon;
  return (
    <>
      <footer
        className={`composer-dock shrink-0 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-1 sm:px-5 sm:pb-4 lg:px-8 ${workspaceView === "chat" && activeSession ? "" : "hidden"}`}
      >
        <div className="chat-content-width mx-auto">
          <div
            className="composer-shell overflow-visible rounded-2xl p-3"
            data-drop={dragActive ? "true" : "false"}
            onDragEnter={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              void addAttachments(filesFromDataTransfer(event.dataTransfer));
            }}
          >
            {queuedTurns.length > 0 && (
              <QueuedTurnsPanel
                items={queuedTurns}
                running={runState?.status === "running"}
                editingId={editingQueueId}
                editValue={queueDraft}
                onEditValue={setQueueDraft}
                onBeginEdit={(item) => {
                  setEditingQueueId(item.id);
                  setQueueDraft(queueDisplayMessage(item));
                }}
                onCancelEdit={() => {
                  setEditingQueueId("");
                  setQueueDraft("");
                }}
                onSaveEdit={(id, value) => void updateQueuedTurn(id, value)}
                onRemove={removeQueuedTurn}
                onMove={moveQueuedTurn}
                onStartNext={startNextQueuedTurn}
              />
            )}
            {runState && runState.status !== "running" && (
              <RunSummary state={runState} />
            )}
            {(mentionRange || slashOpen) && (
              <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-border bg-background p-1 text-xs shadow-sm">
                {slashOpen &&
                  sortSlashCommands([...SLASH_COMMANDS, ...extraSlashCommands])
                    .filter((item) =>
                      item.name.startsWith(
                        slashQuery(input, inputRef.current?.selectionStart ?? input.length) ?? "/"
                      )
                    )
                    .map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted"
                        onClick={() => {
                          setInput(`${item.name} `);
                          setSlashOpen(false);
                          inputRef.current?.focus();
                        }}
                      >
                        <span className="font-medium">{item.name}</span>
                        <span className="text-[10px] text-muted-foreground">{item.title}</span>
                      </button>
                    ))}
                {mentionRange &&
                  mentionItems.map((item) => (
                    <button
                      key={`${item.kind}:${item.path}:${item.line ?? 0}`}
                      type="button"
                      className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted"
                      onClick={() => {
                        const caret = inputRef.current?.selectionStart ?? input.length;
                        setInput(insertAt(input, mentionRange.start, caret, `@${item.path} `));
                        setMentionRange(null);
                        setMentionItems([]);
                        inputRef.current?.focus();
                      }}
                    >
                      <span className="font-medium">{item.path}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {item.kind === "content" ? `L${item.line}` : "文件"}
                      </span>
                    </button>
                  ))}
              </div>
            )}
            {dragActive && <div className="composer-drop-hint">松开鼠标即可添加附件</div>}
            {attachments.length > 0 && (
              <div className="composer-attachments">
                {attachments.map((item) => (
                  <div key={item.id} className="composer-attachment">
                    {item.kind === "image" && item.previewUrl ? (
                      <img src={item.previewUrl} alt="" />
                    ) : item.kind === "image" ? (
                      <Image className="size-4" />
                    ) : (
                      <FileText className="size-4" />
                    )}
                    <span className="min-w-0 truncate" title={item.name}>
                      {item.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatBytes(item.size)}
                    </span>
                    <button
                      type="button"
                      className="grid size-5 place-items-center rounded-full hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`移除 ${item.name}`}
                      onClick={() =>
                        setAttachments((current) => current.filter((file) => file.id !== item.id))
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {attachError ? (
              <p className="px-2 pb-1 text-[11px] text-destructive">{attachError}</p>
            ) : null}
            <Textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => {
                const value = e.target.value;
                const caret = e.target.selectionStart ?? value.length;
                setInput(value);
                const mention = mentionQuery(value, caret);
                setMentionRange(mention);
                setSlashOpen(Boolean(slashQuery(value, caret)));
                if (mention && projectId) {
                  void api<{ matches: FileSearchMatch[] }>(
                    `/api/projects/${projectId}/files/search?q=${encodeURIComponent(mention.query || ".")}&content=false`
                  )
                    .then((result) =>
                      setMentionItems(
                        result.matches.filter((item) => item.type !== "directory").slice(0, 8)
                      )
                    )
                    .catch(() => setMentionItems([]));
                } else {
                  setMentionItems([]);
                }
              }}
              onPaste={(event) => {
                const files = filesFromClipboard(event.clipboardData);
                if (!files.length) return;
                event.preventDefault();
                void addAttachments(files);
              }}
              onKeyDown={(e) => {
                const sendKey = workspaceSettings.sendWithEnter
                  ? e.key === "Enter" && !e.shiftKey
                  : e.key === "Enter" && (e.ctrlKey || e.metaKey);
                if (sendKey) {
                  e.preventDefault();
                  send();
                }
              }}
              className="max-h-40 min-h-12 w-full resize-none border-0 bg-transparent px-2 py-1 text-base leading-6 shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0 dark:bg-transparent sm:min-h-14 sm:text-sm"
              title={
                workspaceSettings.sendWithEnter
                  ? "Enter 发送，Shift+Enter 换行"
                  : "Ctrl/Cmd+Enter 发送"
              }
              placeholder={`在 ${activeProject?.name ?? "当前工程"} 中询问 Codex...`}
            />
            <div className="composer-toolbar">
              <div className="composer-context">
                <Select value={providerId} onValueChange={setProviderId}>
                  <SelectTrigger
                    className="composer-select max-w-[7.5rem] sm:max-w-[11rem]"
                    title={
                      selectedProvider?.name ? `供应商：${selectedProvider.name}` : "选择供应商"
                    }
                  >
                    <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder="供应商" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={model} onValueChange={setModel} disabled={!availableModels.length}>
                  <SelectTrigger
                    className="composer-select max-w-[8.5rem] sm:max-w-[13rem]"
                    title={model ? `模型：${model}` : "选择模型"}
                  >
                    <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder={selectedProvider?.model || "模型"} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {connection !== "connected" ? (
                  <StatusChip
                    icon={
                      connection === "connecting" || connection === "reconnecting"
                        ? LoaderCircle
                        : WifiOff
                    }
                    iconClassName={
                      connection === "connecting" || connection === "reconnecting"
                        ? "animate-spin text-amber-500"
                        : "text-red-500"
                    }
                    title={
                      connection === "connecting"
                        ? "WebSocket 连接中"
                        : connection === "reconnecting"
                          ? `正在恢复连接（第 ${Math.max(1, reconnectAttempt)} 次）`
                          : "连接多次未恢复，仍会继续重试"
                    }
                    label={connection === "reconnecting" ? "重连中" : "未连接"}
                  />
                ) : null}
                {approvalNotice ? (
                  <StatusChip
                    icon={ShieldQuestion}
                    iconClassName="text-amber-600"
                    title={approvalNotice}
                    label={`待审批 ${pendingApprovals.length}`}
                  />
                ) : null}
                {queuedTurns.length > 0 ? (
                  <StatusChip
                    icon={ListPlus}
                    title={`待发送队列 ${queuedTurns.length} 条`}
                    label={`队列 ${queuedTurns.length}`}
                  />
                ) : null}
                {sendNotice && !runState ? (
                  <span className="min-w-0 truncate text-xs text-primary">{sendNotice}</span>
                ) : null}
              </div>
              <div className="composer-actions">
                <input
                  ref={attachInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = event.target.files ? [...event.target.files] : [];
                    event.target.value = "";
                    void addAttachments(files);
                  }}
                />
                {(input.trim() || attachments.length > 0) && (
                  <span className="composer-meta" title={contextEstimate}>
                    {contextEstimate}
                  </span>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-lg"
                  aria-label="添加附件"
                  title="添加附件，也可拖入或粘贴图片"
                  onClick={() => attachInputRef.current?.click()}
                >
                  <Paperclip className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-lg"
                  aria-label="强化提示词"
                  title="强化提示词，让请求更具体"
                  disabled={!input.trim() || enhanceBusy}
                  onClick={() => openEnhance()}
                >
                  {enhanceBusy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                </Button>
                <div className="relative">
                  <Button
                    type="button"
                    variant="outline"
                    className="composer-runtime-btn h-8 rounded-lg px-2.5"
                    title={`${workspaceSettings.executionMode === "plan" ? "Plan：只读规划" : "Execute：按当前权限执行"} · ${sandbox.label}`}
                    onClick={() => setRuntimeOptionsOpen((value) => !value)}
                  >
                    <SandboxIcon className="size-3.5" />
                    <span className="composer-runtime-label">
                      {workspaceSettings.executionMode === "plan" ? "Plan" : "Execute"}
                      <span className="text-muted-foreground"> · {sandbox.label}</span>
                    </span>
                  </Button>
                  {runtimeOptionsOpen && (
                    <RuntimeOptionsPanel
                      settings={workspaceSettings}
                      onChange={saveWorkspaceSettings}
                      onClose={() => setRuntimeOptionsOpen(false)}
                      homePath={selectedProvider?.codexHome || runtimeCodexHome}
                    />
                  )}
                </div>
                {runState?.status === "running" && (
                  <Button
                    size="icon"
                    variant="destructive"
                    className="size-8 rounded-lg"
                    aria-label="停止当前任务"
                    onClick={cancelTurn}
                  >
                    <Square className="size-4" />
                  </Button>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className="inline-flex"
                      aria-label={
                        blockReason ??
                        (runState?.status === "running" || pendingApprovals.length
                          ? "加入消息队列"
                          : connection === "connected"
                            ? "发送消息"
                            : "连接后发送消息")
                      }
                    >
                      <Button
                        size="icon"
                        className="size-8 rounded-lg"
                        onClick={send}
                        disabled={Boolean(blockReason)}
                        aria-label={
                          blockReason ??
                          (runState?.status === "running" || pendingApprovals.length
                            ? "加入消息队列"
                            : "发送消息")
                        }
                      >
                        {runState?.status === "running" || pendingApprovals.length ? (
                          <ListPlus className="size-4" />
                        ) : (
                          <Send className="size-4" />
                        )}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {blockReason ??
                      (runState?.status === "running" || pendingApprovals.length
                        ? "加入消息队列"
                        : "发送消息")}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </footer>
      <PromptEnhanceDialog
        open={enhanceOpen}
        original={enhanceOriginal}
        enhanced={enhanceText}
        busy={enhanceBusy}
        error={enhanceError}
        model={enhanceModel}
        onOpenChange={setEnhanceOpen}
        onChangeEnhanced={setEnhanceText}
        onApply={() => {
          if (!enhanceText.trim()) return;
          setInput(enhanceText.trim());
          setEnhanceOpen(false);
        }}
        onStart={() => void runEnhance()}
        onRetry={() => void runEnhance()}
      />
    </>
  );
}
