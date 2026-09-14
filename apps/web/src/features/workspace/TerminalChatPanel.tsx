import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ArrowDown,
  BotMessageSquare,
  ChevronUp,
  Clipboard,
  Command,
  Copy,
  CornerDownLeft,
  Delete,
  Download,
  Eraser,
  FileText,
  History as HistoryIcon,
  Image,
  Keyboard,
  LoaderCircle,
  PanelBottomClose,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Square,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { toast } from "sonner";
import { numberedDuplicateTitles } from "@codex-omni/protocol";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/context/theme-provider";
import { api, apiUpload, terminalChatWsUrl } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { createId } from "@/lib/utils";
import type { Project, Session, TerminalChatSession } from "@/types";
import {
  ATTACHMENT_UPLOAD_DIR,
  attachmentUploadPath,
  collectComposerAttachments,
  filesFromClipboard,
  filesFromDataTransfer,
  formatBytes,
  type ComposerAttachment,
  type FileLike
} from "./composer-attachments";
import { LiveDuration } from "./WorkspaceStatus";
import { PromptTemplatePicker } from "./PromptTemplatePicker";
import { joinInsertedTemplate } from "./prompt-templates";
import {
  canDecreaseTerminalFontSize,
  canFitTerminal,
  canIncreaseTerminalFontSize,
  chromePointerMovedTooFar,
  composeTerminalAttachmentCommand,
  encodeTerminalComposerPayload,
  encodeTerminalModifiedInput,
  filterCommandHistory,
  isCoarsePointer,
  loadTerminalFontSize,
  persistTerminalFontSize,
  stepTerminalFontSize,
  isDuplicateChromeClick,
  isTouchLikePointer,
  joinVisibleLines,
  refreshTerminal,
  scheduleTerminalFit,
  shouldFocusTerminalAfterChromeAction,
  shouldPreventChromePointerDefault,
  shouldResetTerminalSnapshot,
  shouldSubmitTerminalKeyboard,
  terminalCopyPayload,
  terminalKeepaliveClassName,
  attachTerminalTouchScroll,
  xtermTheme
} from "./terminal-chrome";

type SessionList = { items: TerminalChatSession[] };
type Profile = { id: string; name: string; executable: string; args: string[] };
type TerminalHistoryItem = { seq: number; kind: string; data: string; createdAt?: number };

const control = (key: string) => String.fromCharCode(key.toUpperCase().charCodeAt(0) & 31);
const chromeIconClass =
  "inline-flex h-8 min-w-8 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-border bg-background px-2 text-foreground select-none active:bg-muted dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:active:bg-white/15";
const padKeyClass =
  "inline-flex h-8 min-w-0 w-full touch-manipulation items-center justify-center rounded-lg border border-border bg-background px-1 text-[11px] font-medium text-foreground select-none active:bg-muted dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:active:bg-white/15";
const modifierClass = (pressed: boolean) =>
  `inline-flex h-8 min-w-14 shrink-0 touch-manipulation items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium select-none ${
    pressed
      ? "border-sky-500 bg-sky-500/15 text-sky-800 dark:border-sky-400 dark:bg-sky-400/20 dark:text-sky-100"
      : "border-border bg-background text-foreground dark:border-white/15 dark:bg-white/5 dark:text-slate-200"
  }`;

function transferHasFiles(data: DataTransfer | null | undefined) {
  return Boolean(data?.types.includes("Files"));
}

function fileDragHandlers(
  setDragActive: (value: boolean) => void,
  onFiles: (files: FileLike[]) => void
) {
  return {
    onDragEnter: (event: { dataTransfer: DataTransfer; preventDefault: () => void }) => {
      if (!transferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      setDragActive(true);
    },
    onDragOver: (event: { dataTransfer: DataTransfer; preventDefault: () => void }) => {
      if (!transferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragActive(true);
    },
    onDragLeave: (event: { currentTarget: EventTarget & { contains: (node: Node) => boolean }; relatedTarget: EventTarget | null; }) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setDragActive(false);
    },
    onDrop: (event: { dataTransfer: DataTransfer; preventDefault: () => void }) => {
      if (!transferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      setDragActive(false);
      onFiles(filesFromDataTransfer(event.dataTransfer));
    }
  };
}

function statusLabel(session: TerminalChatSession, connected: boolean) {
  const parts = [
    connected
      ? session.pid
        ? `已连接 · PID ${session.pid}`
        : "已连接"
      : "正在恢复连接，终端仍在后台运行"
  ];
  if (session.state === "needs_attention") parts.push("已暂停自动重启");
  else if (session.restartPolicy === "on-unexpected-exit") parts.push("异常退出自动重启");
  else parts.push("手动重启");
  if (session.restartCount) parts.push(`已重启 ${session.restartCount} 次`);
  if (session.state === "stopped") parts.push("已停止");
  else if (session.state === "exited") parts.push("进程已退出");
  else if (session.state === "failed") parts.push(session.lastError || "启动失败");
  return parts.join(" · ");
}

function TerminalChatViewport({
  project,
  session,
  onChange,
  active = true,
  tabBar,
  sessionActions,
  fontSize,
  onFontSizeChange
}: {
  project: Project;
  session: TerminalChatSession;
  onChange: (next: Partial<TerminalChatSession>) => void;
  active?: boolean;
  tabBar: ReactNode;
  sessionActions: ReactNode;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
}) {
  const { resolvedTheme } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const resolvedThemeRef = useRef(resolvedTheme);
  resolvedThemeRef.current = resolvedTheme;
  const socket = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);
  const reconnect = useRef<number | null>(null);
  const attempts = useRef(0);
  const ctrlRef = useRef(false);
  const altRef = useRef(false);
  const shiftRef = useRef(false);
  const stickyRef = useRef({ ctrl: false, alt: false, shift: false });
  const onChangeRef = useRef(onChange);
  const outputRef = useRef("");
  const firstSeqRef = useRef(1);
  const lastPidRef = useRef<number | null>(session.pid ?? null);
  const fitRef = useRef<() => void>(() => {});
  const pageVisibleRef = useRef(document.visibilityState === "visible");
  const lastPointerType = useRef<string | undefined>(undefined);
  const chromePointerStartX = useRef(0);
  const pasteAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const lineRef = useRef<HTMLTextAreaElement | null>(null);
  const historyPanelRef = useRef<HTMLDivElement | null>(null);
  const historyButtonRef = useRef<HTMLSpanElement | null>(null);
  const shortcutPanelRef = useRef<HTMLDivElement | null>(null);
  const shortcutButtonRef = useRef<HTMLSpanElement | null>(null);
  const comboRef = useRef<HTMLInputElement | null>(null);
  const comboComposing = useRef(false);
  const comboKeySent = useRef(false);
  const lineComposing = useRef(false);
  const [connected, setConnected] = useState(false);
  const [composerOpen, setComposerOpen] = useState(() => {
    try {
      const stored = window.localStorage.getItem("codex-omni:terminal-chat-composer-open");
      if (stored === "0") return false;
      if (stored === "1") return true;
    } catch {
      // Storage can be unavailable in private browsing.
    }
    return true;
  });
  const [autoEnter, setAutoEnter] = useState(() => {
    try {
      const stored = window.localStorage.getItem("codex-omni:terminal-chat-auto-enter");
      if (stored === "0") return false;
      if (stored === "1") return true;
    } catch {
      // Storage can be unavailable in private browsing.
    }
    return true;
  });
  const [draft, setDraft] = useState("");
  const [ctrl, setCtrl] = useState(false);
  const [alt, setAlt] = useState(false);
  const [shift, setShift] = useState(false);
  const [sticky, setSticky] = useState({ ctrl: false, alt: false, shift: false });
  const [atBottom, setAtBottom] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [firstSeq, setFirstSeq] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<TerminalHistoryItem[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [comboDraft, setComboDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachError, setAttachError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const addAttachmentsRef = useRef<(files: FileLike[]) => Promise<void>>(async () => {});

  const sendRaw = useCallback((data: string) => {
    if (!data) return;
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "terminal.input", terminalId: session.id, data }));
  }, [session.id]);

  const sendInput = useCallback((rawData: string, applyLatchedModifiers = true) => {
    const data = applyLatchedModifiers
      ? encodeTerminalModifiedInput(rawData, { ctrl: ctrlRef.current, alt: altRef.current, shift: shiftRef.current })
      : rawData;
    if (applyLatchedModifiers) {
      if (ctrlRef.current && !stickyRef.current.ctrl) {
        ctrlRef.current = false;
        setCtrl(false);
      }
      if (altRef.current && !stickyRef.current.alt) {
        altRef.current = false;
        setAlt(false);
      }
      if (shiftRef.current && !stickyRef.current.shift) {
        shiftRef.current = false;
        setShift(false);
      }
    }
    sendRaw(data);
  }, [sendRaw]);
  const sendInputRef = useRef(sendInput);
  sendInputRef.current = sendInput;

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { ctrlRef.current = ctrl; }, [ctrl]);
  useEffect(() => { altRef.current = alt; }, [alt]);
  useEffect(() => { shiftRef.current = shift; }, [shift]);
  useEffect(() => { stickyRef.current = sticky; }, [sticky]);
  useEffect(() => {
    try {
      window.localStorage.setItem("codex-omni:terminal-chat-composer-open", composerOpen ? "1" : "0");
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, [composerOpen]);
  useEffect(() => {
    try {
      window.localStorage.setItem("codex-omni:terminal-chat-auto-enter", autoEnter ? "1" : "0");
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, [autoEnter]);
  useEffect(() => {
    if (!shortcutOpen || !(ctrl || alt || shift)) return;
    comboRef.current?.focus();
  }, [shortcutOpen, ctrl, alt, shift]);
  useEffect(() => {
    if (pasteOpen) pasteAreaRef.current?.focus();
  }, [pasteOpen]);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`terminal-command-history:${session.id}`);
      const parsed: unknown = stored ? JSON.parse(stored) : null;
      if (Array.isArray(parsed)) setCommandHistory(parsed.filter((item): item is string => typeof item === "string").slice(0, 200));
    } catch {
      setCommandHistory([]);
    }
  }, [session.id]);

  const rememberCommand = (value: string) => {
    const command = value.trim();
    if (!command) return;
    setCommandHistory((current) => {
      const next = [command, ...current.filter((item) => item !== command)].slice(0, 200);
      try {
        window.localStorage.setItem(`terminal-command-history:${session.id}`, JSON.stringify(next));
      } catch {
        // Storage can be unavailable in private browsing.
      }
      return next;
    });
  };

  const loadCommandHistory = async () => {
    setHistoryLoading(true);
    try {
      const result = await api<{ items: TerminalHistoryItem[] }>(`/api/terminal-sessions/${session.id}/history?limit=5000`);
      const serverCommands = result.items
        .filter((item) => item.kind === "input")
        .map((item) => item.data.replace(/[\r\n]+$/g, "").trim())
        .filter(Boolean);
      setCommandHistory((current) => {
        const next = [...serverCommands.reverse(), ...current]
          .filter((item, index, list) => item && list.indexOf(item) === index)
          .slice(0, 200);
        try {
          window.localStorage.setItem(`terminal-command-history:${session.id}`, JSON.stringify(next));
        } catch {
          // Storage can be unavailable in private browsing.
        }
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取终端命令历史失败");
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistory = () => {
    setShortcutOpen(false);
    setHistoryOpen((open) => {
      if (!open) void loadCommandHistory();
      return !open;
    });
  };
  const toggleShortcuts = () => {
    setHistoryOpen(false);
    setHistoryQuery("");
    setShortcutOpen((open) => !open);
  };
  const toggleComposerOpen = () => {
    setComposerOpen((value) => {
      const next = !value;
      if (!next) {
        setHistoryOpen(false);
        setHistoryQuery("");
        setShortcutOpen(false);
      }
      window.setTimeout(() => {
        if (next) {
          lineRef.current?.focus();
          return;
        }
        if (shouldFocusTerminalAfterChromeAction({ pointerType: lastPointerType.current, coarsePointer: isCoarsePointer() })) {
          terminal.current?.focus();
        }
      }, 0);
      return next;
    });
  };
  const applyHistory = (item: string) => {
    setDraft(item);
    setComposerOpen(true);
    setHistoryOpen(false);
    setHistoryQuery("");
    window.setTimeout(() => {
      lineRef.current?.focus();
      const length = item.length;
      lineRef.current?.setSelectionRange(length, length);
    }, 0);
  };

  useEffect(() => {
    if (!historyOpen && !shortcutOpen) return;
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyOpen && (historyPanelRef.current?.contains(target) || historyButtonRef.current?.contains(target))) return;
      if (shortcutOpen && (shortcutPanelRef.current?.contains(target) || shortcutButtonRef.current?.contains(target))) return;
      setHistoryOpen(false);
      setShortcutOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHistoryOpen(false);
      setHistoryQuery("");
      setShortcutOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [historyOpen, shortcutOpen]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const instance = new Terminal({
      cursorBlink: true,
      fontSize,
      lineHeight: 1.15,
      scrollback: 5000,
      disableStdin: false,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      theme: xtermTheme(resolvedThemeRef.current)
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(element);
    terminal.current = instance;
    if (active && shouldFocusTerminalAfterChromeAction({ coarsePointer: isCoarsePointer() })) instance.focus();
    const detachTouchScroll = attachTerminalTouchScroll(element, () => terminal.current);
    const fitTerminal = () => {
      if (!canFitTerminal(element.clientWidth, element.clientHeight)) return;
      try {
        fit.fit();
        if (socket.current?.readyState === WebSocket.OPEN) {
          socket.current.send(JSON.stringify({ type: "terminal.resize", terminalId: session.id, cols: instance.cols, rows: instance.rows }));
        }
      } catch {
        // Hidden while switching workspace tabs.
      }
    };
    fitRef.current = fitTerminal;
    const observer = new ResizeObserver(fitTerminal);
    observer.observe(element);
    const onHostPaste = (event: ClipboardEvent) => {
      const files = filesFromClipboard(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      void addAttachmentsRef.current(files);
    };
    element.addEventListener("paste", onHostPaste, true);
    const dataSubscription = instance.onData((data) => {
      sendInputRef.current(data);
    });
    const scrollSubscription = instance.onScroll(() => {
      const buffer = instance.buffer.active;
      setAtBottom(buffer.viewportY >= buffer.baseY);
    });
    let disposed = false;
    let freshTerminal = true;
    const applyChange = (next: Partial<TerminalChatSession>) => onChangeRef.current(next);
    const connect = () => {
      if (disposed || !pageVisibleRef.current) return;
      const ws = new WebSocket(terminalChatWsUrl());
      socket.current = ws;
      ws.onopen = () => {
        attempts.current = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: "terminal.subscribe", terminalId: session.id, lastSeq: lastSeq.current }));
        fitTerminal();
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.terminalId && message.terminalId !== session.id) return;
        if (message.type === "terminal.snapshot") {
          const output = String(message.payload?.output ?? "");
          const nextPid = typeof message.payload?.terminal?.pid === "number" ? message.payload.terminal.pid : null;
          const reset = freshTerminal || shouldResetTerminalSnapshot({
            replay: Boolean(message.payload?.replay),
            truncated: Boolean(message.payload?.truncated),
            previousPid: lastPidRef.current,
            nextPid
          });
          freshTerminal = false;
          if (reset) {
            instance.reset();
            outputRef.current = output;
          } else if (output) {
            outputRef.current += output;
          }
          const afterWrite = () => {
            fitRef.current();
            refreshTerminal(instance);
          };
          if (output) instance.write(output, afterWrite);
          else afterWrite();
          if (typeof message.payload?.firstSeq === "number") {
            firstSeqRef.current = message.payload.firstSeq;
            setFirstSeq(message.payload.firstSeq);
          }
          if (typeof message.seq === "number") lastSeq.current = message.seq;
          lastPidRef.current = nextPid;
          if (message.payload?.terminal) applyChange(message.payload.terminal);
        } else if (message.type === "terminal.output") {
          if (typeof message.seq === "number" && message.seq <= lastSeq.current) return;
          instance.write(String(message.payload?.data ?? ""));
          outputRef.current = `${outputRef.current}${String(message.payload?.data ?? "")}`.slice(-4 * 1024 * 1024);
          if (typeof message.seq === "number") lastSeq.current = message.seq;
        } else if (message.type === "terminal.exit") {
          lastPidRef.current = null;
          applyChange({ state: "exited", pid: null, lastExitCode: message.payload?.exitCode ?? null });
          instance.write("\r\n\x1b[90m[进程已退出]\x1b[0m\r\n");
        } else if (message.type === "terminal.state") {
          applyChange(message.payload ?? {});
          if (Object.prototype.hasOwnProperty.call(message.payload ?? {}, "pid")) {
            const nextPid = typeof message.payload?.pid === "number" ? message.payload.pid : null;
            if (nextPid != null && nextPid !== lastPidRef.current) {
              instance.reset();
              outputRef.current = "";
              refreshTerminal(instance);
            }
            lastPidRef.current = nextPid;
          }
        }
        else if (message.type === "terminal.marker") {
          const text = String(message.payload?.text ?? "状态更新");
          if (text.includes("已重启")) {
            instance.reset();
            outputRef.current = "";
            refreshTerminal(instance);
          }
          const marker = `\r\n\x1b[90m[${text}]\x1b[0m\r\n`;
          instance.write(marker);
          outputRef.current = `${outputRef.current}${marker}`.slice(-4 * 1024 * 1024);
        }
      };
      ws.onclose = () => {
        if (disposed || !pageVisibleRef.current) return;
        setConnected(false);
        attempts.current += 1;
        reconnect.current = window.setTimeout(connect, Math.min(8000, 500 * 2 ** Math.min(attempts.current, 4)));
      };
      ws.onerror = () => setConnected(false);
    };
    const onVisibilityChange = () => {
      const visible = document.visibilityState === "visible";
      pageVisibleRef.current = visible;
      if (!visible) {
        if (reconnect.current) window.clearTimeout(reconnect.current);
        reconnect.current = null;
        socket.current?.close();
        socket.current = null;
        setConnected(false);
      } else if (!disposed && !socket.current) connect();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    connect();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (reconnect.current) window.clearTimeout(reconnect.current);
      observer.disconnect();
      element.removeEventListener("paste", onHostPaste, true);
      detachTouchScroll();
      dataSubscription.dispose();
      scrollSubscription.dispose();
      socket.current?.close();
      instance.dispose();
      terminal.current = null;
    };
  }, [session.id]);

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = xtermTheme(resolvedTheme);
  }, [resolvedTheme]);
  useEffect(() => {
    const instance = terminal.current;
    if (!instance) return;
    instance.options.fontSize = fontSize;
    return scheduleTerminalFit(() => {
      fitRef.current();
      refreshTerminal(instance);
    });
  }, [fontSize]);
  useEffect(() => {
    if (!active) {
      terminal.current?.blur();
      return;
    }
    return scheduleTerminalFit(() => {
      fitRef.current();
      refreshTerminal(terminal.current);
      if (shouldFocusTerminalAfterChromeAction({ coarsePointer: isCoarsePointer() })) terminal.current?.focus();
    });
  }, [active]);

  const focusTerminalIfAppropriate = () => {
    if (shouldFocusTerminalAfterChromeAction({ pointerType: lastPointerType.current, coarsePointer: isCoarsePointer() })) {
      terminal.current?.focus();
      return;
    }
    terminal.current?.blur();
  };
  const rememberChromePointer = (event: { preventDefault: () => void; pointerType: string; clientX: number }) => {
    if (shouldPreventChromePointerDefault(event.pointerType)) event.preventDefault();
    lastPointerType.current = event.pointerType;
    chromePointerStartX.current = event.clientX;
    if (!shouldFocusTerminalAfterChromeAction({ pointerType: event.pointerType, coarsePointer: isCoarsePointer() })) {
      terminal.current?.blur();
    }
  };
  const chromeActivateProps = (activate: () => void, repeat = false) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      rememberChromePointer(event);
      if (isTouchLikePointer(event.pointerType) || !repeat) return;
      activate();
      const hold = window.setTimeout(() => {
        const timer = window.setInterval(activate, 50);
        const stop = () => {
          window.clearInterval(timer);
          window.clearTimeout(hold);
          event.currentTarget.releasePointerCapture(event.pointerId);
          event.currentTarget.removeEventListener("pointerup", stop);
          event.currentTarget.removeEventListener("pointercancel", stop);
          event.currentTarget.removeEventListener("pointerleave", stop);
        };
        event.currentTarget.addEventListener("pointerup", stop);
        event.currentTarget.addEventListener("pointercancel", stop);
        event.currentTarget.addEventListener("pointerleave", stop);
      }, 280);
      const cancel = () => {
        window.clearTimeout(hold);
        event.currentTarget.removeEventListener("pointerup", cancel);
        event.currentTarget.removeEventListener("pointercancel", cancel);
        event.currentTarget.removeEventListener("pointerleave", cancel);
      };
      event.currentTarget.addEventListener("pointerup", cancel);
      event.currentTarget.addEventListener("pointercancel", cancel);
      event.currentTarget.addEventListener("pointerleave", cancel);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (repeat && !isTouchLikePointer(event.pointerType)) return;
      if (chromePointerMovedTooFar(chromePointerStartX.current, event.clientX)) return;
      activate();
    },
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (repeat || event.detail > 0) return;
      activate();
    }
  });
  const toggleModifier = (key: "ctrl" | "alt" | "shift", stickyLock = false) => {
    const apply = (pressed: boolean, locked: boolean) => {
      setSticky((current) => ({ ...current, [key]: locked }));
      if (key === "ctrl") setCtrl(pressed);
      if (key === "alt") setAlt(pressed);
      if (key === "shift") setShift(pressed);
    };
    if (stickyLock) {
      const locked = !sticky[key];
      apply(locked, locked);
      return;
    }
    if (sticky[key]) {
      apply(false, false);
      return;
    }
    apply(!(key === "ctrl" ? ctrl : key === "alt" ? alt : shift), false);
  };
  const modifierButtonProps = (key: "ctrl" | "alt" | "shift") => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => rememberChromePointer(event),
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse") return;
      if (chromePointerMovedTooFar(chromePointerStartX.current, event.clientX)) return;
      toggleModifier(key);
    },
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (isDuplicateChromeClick(event.detail, lastPointerType.current)) return;
      toggleModifier(key);
    },
    onDoubleClick: () => toggleModifier(key, true)
  });
  const shortcut = (label: string, data: string, title?: string, repeat = false, className = padKeyClass, applyModifiers = true) => (
    <button type="button" className={className} title={title ?? label} aria-label={title ?? label} {...chromeActivateProps(() => { sendInput(data, applyModifiers); focusTerminalIfAppropriate(); }, repeat)}>
      {label}
    </button>
  );
  const sendComboValue = (value: string) => {
    const chars = [...value];
    if (!chars.length) return;
    for (const char of chars) sendInput(char);
    setComboDraft("");
  };
  const readVisibleBufferText = () => {
    const term = terminal.current;
    const buffer = term?.buffer.active;
    if (!term || !buffer) return "";
    const start = Math.max(0, buffer.viewportY);
    const lines: string[] = [];
    const end = Math.min(buffer.length, start + term.rows);
    for (let index = start; index < end; index += 1) lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
    return joinVisibleLines(lines);
  };
  const copyFromTerminal = () => {
    const payload = terminalCopyPayload(terminal.current?.getSelection() ?? "", readVisibleBufferText());
    if (!payload.text) {
      toast.error(payload.message);
      return;
    }
    void copyTextToClipboard(payload.text).then((copied) => {
      if (copied) toast.success(payload.message);
      else toast.error("复制失败");
    });
    focusTerminalIfAppropriate();
  };
  const closePasteDialog = () => {
    setPasteOpen(false);
    setPasteDraft("");
  };
  const openPasteDialog = () => {
    setHistoryOpen(false);
    setHistoryQuery("");
    setShortcutOpen(false);
    setPasteDraft("");
    setPasteOpen(true);
    if (!navigator.clipboard?.readText) return;
    void navigator.clipboard.readText().then((value) => {
      if (value) setPasteDraft(value);
    }).catch(() => {
      // iOS / insecure origins cannot read the clipboard; the dialog is the fallback.
    });
  };
  const pasteIntoTerminal = () => {
    openPasteDialog();
  };
  const submitPasteDialog = () => {
    const value = pasteDraft;
    closePasteDialog();
    if (value) sendInput(value, false);
    focusTerminalIfAppropriate();
  };
  const addAttachments = async (files: FileLike[]) => {
    if (!files.length) return;
    try {
      const result = await collectComposerAttachments(attachments, files, createId);
      setAttachments(result.items);
      setAttachError(result.error ?? "");
      if (result.items.length) {
        setComposerOpen(true);
        window.setTimeout(() => lineRef.current?.focus(), 0);
      }
      if (result.error) toast.error(result.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : "添加附件失败";
      setAttachError(message);
      toast.error(message);
    }
  };
  addAttachmentsRef.current = addAttachments;
  const uploadAttachments = async (files: ComposerAttachment[]) => {
    try {
      await api(`/api/projects/${project.id}/files`, {
        method: "POST",
        body: JSON.stringify({ path: ATTACHMENT_UPLOAD_DIR, type: "directory" })
      });
    } catch (error) {
      const notice = error instanceof Error ? error.message : String(error);
      if (!notice.includes("已存在")) throw error;
    }
    const uploaded: Array<{ name: string; path: string }> = [];
    for (const file of files) {
      const path = attachmentUploadPath(file.name);
      const copy = new ArrayBuffer(file.bytes.byteLength);
      new Uint8Array(copy).set(file.bytes);
      await apiUpload(
        `/api/projects/${project.id}/files/upload?path=${encodeURIComponent(path)}&overwrite=true`,
        copy
      );
      uploaded.push({ name: file.name, path });
    }
    return uploaded;
  };
  const submitLine = () => {
    if (lineComposing.current || uploadingRef.current) return;
    void (async () => {
      let command = draft;
      let shouldSubmit = Boolean(command.trim());
      if (attachments.length) {
        uploadingRef.current = true;
        setUploading(true);
        try {
          const uploaded = await uploadAttachments(attachments);
          const composed = composeTerminalAttachmentCommand(
            draft,
            uploaded.map((item) => item.path)
          );
          command = composed.command;
          shouldSubmit = composed.submit;
          setAttachments([]);
          setAttachError("");
          toast.success(
            shouldSubmit
              ? `已保存到 ${ATTACHMENT_UPLOAD_DIR}`
              : `已保存到 ${ATTACHMENT_UPLOAD_DIR}，路径已填入输入框`
          );
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "上传附件失败");
          return;
        } finally {
          uploadingRef.current = false;
          setUploading(false);
        }
      }
      if (!command.trim()) return;
      if (!shouldSubmit) {
        setDraft(command);
        window.setTimeout(() => {
          lineRef.current?.focus();
          const length = command.length;
          lineRef.current?.setSelectionRange(length, length);
        }, 0);
        return;
      }
      rememberCommand(command);
      const payload = encodeTerminalComposerPayload(command, autoEnter);
      if (payload) sendRaw(payload);
      if (!autoEnter && shouldFocusTerminalAfterChromeAction({ pointerType: lastPointerType.current, coarsePointer: isCoarsePointer() })) {
        window.setTimeout(() => terminal.current?.focus(), 0);
      }
      setDraft("");
      setHistoryOpen(false);
      setHistoryQuery("");
      setShortcutOpen(false);
    })();
  };
  const downloadLog = () => {
    const blob = new Blob([outputRef.current || readVisibleBufferText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${session.title || "terminal"}.log`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const runSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setSearchHits([]);
      return;
    }
    try {
      const result = await api<{ items: TerminalHistoryItem[] }>(`/api/terminal-sessions/${session.id}/transcript?q=${encodeURIComponent(query)}&limit=100`);
      setSearchHits(result.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "搜索终端输出失败");
    }
  };
  const loadEarlier = async () => {
    if (loadingEarlier || firstSeqRef.current <= 1) return;
    setLoadingEarlier(true);
    try {
      const result = await api<{ items: TerminalHistoryItem[] }>(`/api/terminal-sessions/${session.id}/history?beforeSeq=${firstSeqRef.current}&limit=2000`);
      const older = result.items.filter((item) => item.kind === "output").map((item) => item.data).join("");
      if (!older) {
        firstSeqRef.current = 1;
        setFirstSeq(1);
        return;
      }
      outputRef.current = `${older}${outputRef.current}`.slice(-4 * 1024 * 1024);
      firstSeqRef.current = result.items[0]?.seq ?? 1;
      setFirstSeq(firstSeqRef.current);
      const current = terminal.current;
      if (current) {
        current.reset();
        current.write(outputRef.current);
        current.scrollToBottom();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载更早输出失败");
    } finally {
      setLoadingEarlier(false);
    }
  };

  const visibleHistory = filterCommandHistory(commandHistory, historyQuery);
  const modifierChord = [ctrl ? "Ctrl" : null, alt ? "Alt" : null, shift ? "Shift" : null].filter(Boolean).join("+");

  const padModifier = (pressed: boolean) =>
    `${modifierClass(pressed)} min-w-0 w-full px-1 text-[11px]`;
  const shortcutPad = (
    <div className="flex w-[18rem] flex-col gap-1.5 p-2">
      <div className="grid grid-cols-3 gap-1">
        <button type="button" className={padModifier(ctrl)} aria-pressed={ctrl} title={sticky.ctrl ? "Ctrl 连续锁定，再点一次取消" : "Ctrl：点按后输入字母，例如 A 发送 Ctrl+A"} {...modifierButtonProps("ctrl")}>Ctrl{sticky.ctrl ? " *" : ""}</button>
        <button type="button" className={padModifier(alt)} aria-pressed={alt} title={sticky.alt ? "Alt 连续锁定，再点一次取消" : "Alt：点按后输入字母，例如 X 发送 Alt+X"} {...modifierButtonProps("alt")}>Alt{sticky.alt ? " *" : ""}</button>
        <button type="button" className={padModifier(shift)} aria-pressed={shift} title={sticky.shift ? "Shift 连续锁定，再点一次取消" : "Shift：点按后输入字母或方向键"} {...modifierButtonProps("shift")}>Shift{sticky.shift ? " *" : ""}</button>
      </div>
      <label className="flex h-8 items-center rounded-lg border border-border bg-background px-2 dark:border-white/15 dark:bg-white/5">
        {modifierChord ? <span className="mr-1 shrink-0 text-[11px] font-medium text-sky-700 dark:text-sky-300">{modifierChord}+</span> : null}
        <input
          ref={comboRef}
          value={comboDraft}
          aria-label={modifierChord ? `输入字符发送 ${modifierChord} 组合键` : "输入字符立即发送到终端"}
          placeholder={modifierChord ? "输入 A" : "输入字符，例如 A"}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          onCompositionStart={() => { comboComposing.current = true; }}
          onCompositionEnd={(event) => {
            comboComposing.current = false;
            sendComboValue(event.currentTarget.value);
          }}
          onChange={(event) => {
            const next = event.target.value;
            if (comboKeySent.current) {
              comboKeySent.current = false;
              setComboDraft("");
              return;
            }
            if (comboComposing.current) {
              setComboDraft(next);
              return;
            }
            if (!next) {
              setComboDraft("");
              return;
            }
            sendComboValue(next);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || comboComposing.current) return;
            if (event.key === "Enter") {
              event.preventDefault();
              sendInput("\r");
              return;
            }
            if (event.key.length === 1 && !event.metaKey) {
              event.preventDefault();
              comboKeySent.current = true;
              sendInput(event.key);
              setComboDraft("");
            }
          }}
        />
      </label>
      <p className="px-0.5 text-[11px] leading-4 text-muted-foreground">
        {modifierChord ? `${modifierChord} 已按下，输入 A 即发送 ${modifierChord}+A` : "先点 Ctrl / Alt / Shift，再输入字符发送组合键"}
      </p>
      <div className="grid grid-cols-4 gap-1">
        {shortcut("Esc", "\x1b", undefined, false, padKeyClass)}
        {shortcut("Tab", "\t", undefined, false, padKeyClass)}
        {shortcut("Home", "\x1b[H", undefined, false, padKeyClass)}
        {shortcut("End", "\x1b[F", undefined, false, padKeyClass)}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {shortcut("←", "\x1b[D", "方向左", true, padKeyClass)}
        {shortcut("↑", "\x1b[A", "方向上", true, padKeyClass)}
        {shortcut("↓", "\x1b[B", "方向下", true, padKeyClass)}
        {shortcut("→", "\x1b[C", "方向右", true, padKeyClass)}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {(["C", "D", "Z", "L"] as const).map((key) => shortcut(`^${key}`, control(key), `Ctrl+${key}`, false, padKeyClass, false))}
      </div>
      <div className="grid grid-cols-3 gap-1 border-t border-border pt-1 dark:border-white/10">
        <button type="button" className={`${chromeIconClass} min-w-0 w-full`} title="复制" aria-label="复制终端内容" {...chromeActivateProps(copyFromTerminal)}>
          <Copy className="size-4" />
        </button>
        <button type="button" className={`${chromeIconClass} min-w-0 w-full`} title="粘贴" aria-label="粘贴" {...chromeActivateProps(pasteIntoTerminal)}>
          <Clipboard className="size-4" />
        </button>
        <button type="button" className={`${chromeIconClass} min-w-0 w-full`} title="清屏（Ctrl+L）" aria-label="清屏" {...chromeActivateProps(() => { sendInput("\x0c", false); focusTerminalIfAppropriate(); })}>
          <Eraser className="size-4" />
        </button>
      </div>
    </div>
  );

  const dropHandlers = fileDragHandlers(setDragActive, (files) => { void addAttachments(files); });
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-background text-foreground dark:bg-[#090d14] dark:text-slate-100"
      {...dropHandlers}
    >
      <div className="relative flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-muted/70 px-2 text-[11px] text-muted-foreground [scrollbar-width:none] dark:border-white/10 dark:bg-slate-950/80 dark:text-slate-300 [&::-webkit-scrollbar]:hidden">
        {tabBar}
        <span className={`size-1.5 shrink-0 rounded-full ${connected ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`} />
        <span className="min-w-0 max-w-[9rem] truncate sm:max-w-[16rem]" title={statusLabel(session, connected)}>
          {connected ? (session.pid ? `PID ${session.pid}` : "已连接") : "恢复中"}
          {session.state === "running" ? <> · <LiveDuration startedAt={session.createdAt} /></> : null}
        </span>
        <span className="hidden min-w-0 max-w-[28%] truncate font-mono dark:text-slate-500 lg:block" title={session.cwd}>{session.cwd}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 hover:bg-accent disabled:opacity-40 dark:hover:bg-white/10 ${firstSeq > 1 ? "text-sky-700 dark:text-sky-300" : "text-muted-foreground dark:text-slate-300"}`}
          aria-label="加载更早输出"
          title={firstSeq > 1 ? "仅显示最近输出，点击加载更早历史" : "已是最早输出"}
          disabled={loadingEarlier || firstSeq <= 1}
          {...chromeActivateProps(() => { void loadEarlier(); })}
        >
          {loadingEarlier ? <LoaderCircle className="size-3.5 animate-spin" /> : <ChevronUp className="size-3.5" />}
          <span>{loadingEarlier ? "加载中" : "更早"}</span>
        </button>
        <button type="button" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/10" aria-label="缩小终端字体" title="缩小终端字体" disabled={!canDecreaseTerminalFontSize(fontSize)} {...chromeActivateProps(() => onFontSizeChange(stepTerminalFontSize(fontSize, -1)))}>
          <ZoomOut className="size-3.5" />
        </button>
        <button type="button" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/10" aria-label="放大终端字体" title="放大终端字体" disabled={!canIncreaseTerminalFontSize(fontSize)} {...chromeActivateProps(() => onFontSizeChange(stepTerminalFontSize(fontSize, 1)))}>
          <ZoomIn className="size-3.5" />
        </button>
        <button type="button" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent dark:text-slate-300 dark:hover:bg-white/10" aria-label="搜索终端历史" {...chromeActivateProps(() => setSearchOpen((value) => !value))}>
          <Search className="size-3.5" />
        </button>
        <button type="button" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent dark:text-slate-300 dark:hover:bg-white/10" aria-label="下载终端输出" {...chromeActivateProps(downloadLog)}>
          <Download className="size-3.5" />
        </button>
        {sessionActions}
        </div>
        {searchOpen && (
          <form className="absolute right-2 top-9 z-20 w-[min(22rem,calc(100vw-1rem))] rounded-lg border border-border bg-card p-2 shadow-xl dark:border-white/15 dark:bg-slate-900" onSubmit={runSearch}>
            <div className="flex gap-1.5">
              <input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索终端历史" className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none dark:border-white/15 dark:bg-white/5 dark:text-slate-100" />
              <Button type="submit" size="sm" className="h-8">搜索</Button>
            </div>
            <div className="mt-2 max-h-52 overflow-y-auto text-[11px] text-muted-foreground dark:text-slate-300">
              {searchHits.length ? searchHits.map((hit) => (
                <div key={`${hit.seq}-${hit.createdAt}`} className="border-t border-border py-1.5 dark:border-white/10">
                  <span className="mr-1 text-muted-foreground">#{hit.seq}</span>
                  <span className="break-words">{hit.data.slice(0, 240)}</span>
                </div>
              )) : <span className="text-muted-foreground">输入关键词搜索</span>}
            </div>
          </form>
        )}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 p-1">
        <div ref={host} className="h-full touch-none overscroll-contain" />
        {dragActive ? (
          <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-xl border border-dashed border-sky-400/70 bg-sky-500/10 text-sm text-sky-800 dark:border-sky-400/50 dark:text-sky-100">
            松开鼠标即可添加附件
          </div>
        ) : null}
        {!atBottom && (
          <button type="button" className={`absolute right-3 grid size-9 place-items-center rounded-lg border border-border bg-card/90 text-foreground shadow-lg dark:border-white/15 dark:bg-slate-900/90 dark:text-slate-100 ${composerOpen ? "bottom-3" : "bottom-14"}`} aria-label="回到底部" onClick={() => { terminal.current?.scrollToBottom(); setAtBottom(true); }}>
            <ArrowDown className="size-4" />
          </button>
        )}
        {!composerOpen ? (
          <button
            type="button"
            className="absolute bottom-3 right-3 z-20 grid size-9 place-items-center rounded-lg border border-sky-400/40 bg-card/95 text-sky-700 shadow-lg dark:border-sky-400/40 dark:bg-slate-900/90 dark:text-sky-300"
            aria-label="显示输入框"
            title="显示输入框，发送文本给终端"
            {...chromeActivateProps(toggleComposerOpen)}
          >
            <Keyboard className="size-4" />
          </button>
        ) : null}
        </div>
      </div>
      {composerOpen ? (
      <div className="composer-dock shrink-0 px-2 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 sm:px-3 sm:pb-2">
        <div className="chat-content-width mx-auto">
          <div className="composer-shell overflow-visible rounded-2xl p-2" data-drop={dragActive ? "true" : "false"}>
          {dragActive ? <div className="composer-drop-hint">松开鼠标即可添加附件</div> : null}
          {attachments.length > 0 ? (
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
                  <span className="min-w-0 truncate" title={item.name}>{item.name}</span>
                  <span className="text-[10px] text-muted-foreground">{formatBytes(item.size)}</span>
                  <button
                    type="button"
                    className="grid size-5 place-items-center rounded-full hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`移除 ${item.name}`}
                    onClick={() => setAttachments((current) => current.filter((file) => file.id !== item.id))}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {attachError ? <p className="px-2 pb-1 text-[11px] text-destructive">{attachError}</p> : null}
          <div className="relative">
            {shortcutOpen ? (
              <div ref={shortcutPanelRef} className="absolute bottom-full left-0 z-30 mb-2 rounded-xl border border-border bg-card shadow-xl dark:border-white/15 dark:bg-slate-900">
                {shortcutPad}
              </div>
            ) : null}
            {historyOpen ? (
              <div ref={historyPanelRef} className="absolute inset-x-0 bottom-full z-30 mb-2 rounded-xl border border-border bg-card p-2 shadow-xl dark:border-white/15 dark:bg-slate-900">
                <div className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2 dark:bg-white/5">
                  <Search className="size-3.5 text-muted-foreground" />
                  <input autoFocus value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索命令历史" className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none" />
                  {historyLoading ? <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" /> : visibleHistory.length ? <span className="text-[11px] text-muted-foreground">{visibleHistory.length}</span> : null}
                </div>
                <div className="mt-1 max-h-56 overflow-y-auto overscroll-contain">
                  {visibleHistory.map((item, index) => (
                    <button key={`${item}-${index}`} type="button" className="flex w-full items-start rounded-lg px-2 py-2 text-left font-mono text-xs hover:bg-muted" onClick={() => applyHistory(item)}>
                      <span className="mr-2 shrink-0 text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 break-words">{item}</span>
                    </button>
                  ))}
                  {!commandHistory.length ? <p className="px-2 py-3 text-center text-xs text-muted-foreground">暂无命令历史</p> : null}
                  {commandHistory.length > 0 && visibleHistory.length === 0 ? <p className="px-2 py-3 text-center text-xs text-muted-foreground">没有匹配的命令</p> : null}
                </div>
              </div>
            ) : null}
            <Textarea
              ref={lineRef}
              rows={2}
              value={draft}
              placeholder={autoEnter ? "发送到终端并回车，Shift+Enter 换行。也可直接操作终端。" : "发送到终端，不自动回车。也可直接操作终端。"}
              aria-label="发送到终端"
              inputMode="text"
              enterKeyHint="send"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              lang="zh-CN"
              className="max-h-40 min-h-10 w-full resize-none border-0 bg-transparent px-2 py-1 font-mono text-sm leading-5 shadow-none outline-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent sm:min-h-12 sm:text-sm"
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const files = filesFromClipboard(event.clipboardData);
                if (!files.length) return;
                event.preventDefault();
                void addAttachments(files);
              }}
              onCompositionStart={() => { lineComposing.current = true; }}
              onCompositionEnd={() => { lineComposing.current = false; }}
              onKeyDown={(event) => {
                if ((ctrl || alt) && !event.metaKey && !lineComposing.current && !event.nativeEvent.isComposing && event.key.length === 1) {
                  event.preventDefault();
                  sendInput(event.key);
                  return;
                }
                const canCycleHistory = !draft.includes("\n") && !event.shiftKey && !event.ctrlKey && !event.metaKey;
                if (event.key === "ArrowUp" && canCycleHistory) {
                  event.preventDefault();
                  const current = commandHistory.findIndex((item) => item === draft);
                  const next = commandHistory[current < 0 ? 0 : Math.min(current + 1, commandHistory.length - 1)];
                  if (next) setDraft(next);
                  return;
                }
                if (event.key === "ArrowDown" && canCycleHistory) {
                  event.preventDefault();
                  const current = commandHistory.findIndex((item) => item === draft);
                  const previous = current > 0 ? commandHistory[current - 1] : undefined;
                  if (previous !== undefined) setDraft(previous);
                  else if (current === 0) setDraft("");
                  return;
                }
                if (!shouldSubmitTerminalKeyboard({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing || lineComposing.current, keyCode: event.nativeEvent.keyCode })) return;
                event.preventDefault();
                submitLine();
              }}
            />
          </div>
          <div className="composer-toolbar">
            <div className="composer-context">
              <Button
                type="button"
                variant="outline"
                className="h-8 shrink-0 rounded-lg px-2.5"
                aria-label="隐藏输入框"
                title="隐藏输入框，终端仍可直通操作"
                {...chromeActivateProps(toggleComposerOpen)}
              >
                <PanelBottomClose className="size-3.5" />
                <span>隐藏</span>
              </Button>
              <Select value={autoEnter ? "enter" : "plain"} onValueChange={(value) => setAutoEnter(value === "enter")}>
                <SelectTrigger
                  className="composer-select terminal-enter-select h-8 w-auto min-w-0"
                  title={autoEnter ? "发送时自动回车" : "发送时不回车，只把文本写入终端"}
                  aria-label="发送时是否回车"
                >
                  <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="enter">自动回车</SelectItem>
                  <SelectItem value="plain">不回车</SelectItem>
                </SelectContent>
              </Select>
              <span ref={shortcutButtonRef} className="inline-flex shrink-0">
                <Button
                  type="button"
                  variant={shortcutOpen || ctrl || alt || shift ? "secondary" : "outline"}
                  className="h-8 rounded-lg px-2.5"
                  aria-label="终端快捷键"
                  aria-haspopup="dialog"
                  aria-expanded={shortcutOpen}
                  title="终端快捷键"
                  onClick={toggleShortcuts}
                >
                  <Command className="size-3.5" />
                  快捷
                </Button>
              </span>
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
              <PromptTemplatePicker
                disabled={uploading}
                onInsert={(text) => setDraft((current) => joinInsertedTemplate(current, text))}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 rounded-lg"
                aria-label="添加附件"
                title="添加附件，也可拖入或粘贴文件"
                disabled={uploading}
                onClick={() => attachInputRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
              <span ref={historyButtonRef} className="inline-flex">
                <Button
                  type="button"
                  variant={historyOpen ? "secondary" : "outline"}
                  className="h-8 rounded-lg px-2.5"
                  aria-label="命令历史"
                  aria-expanded={historyOpen}
                  title="命令历史"
                  onClick={toggleHistory}
                >
                  {historyLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <HistoryIcon className="size-3.5" />}
                  历史
                </Button>
              </span>
              <Button type="button" size="icon" className="size-8 rounded-lg" aria-label="发送到终端" onClick={submitLine} disabled={uploading || (!draft.trim() && attachments.length === 0)}>
                {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>
          </div>
        </div>
      </div>
      ) : null}
      <Dialog open={pasteOpen} onOpenChange={(open) => { if (!open) closePasteDialog(); }}>
        <DialogContent
          className="sm:max-w-lg"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            pasteAreaRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>粘贴到终端</DialogTitle>
            <DialogDescription>可直接粘贴或长按输入框，确认后再发送到终端。</DialogDescription>
          </DialogHeader>
          <textarea
            id="terminal-chat-paste-input"
            ref={pasteAreaRef}
            value={pasteDraft}
            rows={8}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="在此粘贴文本"
            onChange={(event) => setPasteDraft(event.target.value)}
            className="min-h-40 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none dark:border-white/15 dark:bg-white/5 dark:text-slate-100"
          />
          <DialogFooter>
            <Button type="button" variant="outline" className="h-8 rounded-lg" {...chromeActivateProps(closePasteDialog)}>取消</Button>
            <Button type="button" className="h-8 rounded-lg" disabled={!pasteDraft} {...chromeActivateProps(submitPasteDialog)}>发送到终端</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TerminalChatPanel({
  project,
  sessionId = "",
  onOpenSession,
  active = true
}: {
  project: Project;
  sessionId?: string;
  onOpenSession?: (sessionId: string) => void;
  active?: boolean;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [visitedIds, setVisitedIds] = useState<string[]>([]);
  const [fontSize, setFontSize] = useState(() => loadTerminalFontSize(window.innerWidth));
  const changeFontSize = (size: number) => {
    persistTerminalFontSize(size);
    setFontSize(size);
  };
  const sessions = useQuery({ queryKey: ["terminal-chat-sessions", project.id], queryFn: () => api<SessionList>(`/api/projects/${project.id}/terminal-sessions`), refetchInterval: 5000 });
  const profiles = useQuery({ queryKey: ["terminal-profiles"], queryFn: () => api<{ profiles: Profile[] }>("/api/terminal-profiles") });
  const create = useMutation({
    mutationFn: (profileId: string) => api<{ session: Session; terminal: TerminalChatSession }>(`/api/projects/${project.id}/terminal-sessions`, { method: "POST", body: JSON.stringify({ profileId, restartPolicy: "manual" }) }),
    onSuccess: (result) => {
      queryClient.setQueryData<SessionList>(["terminal-chat-sessions", project.id], (current) => ({ items: [result.terminal, ...(current?.items ?? []).filter((item) => item.id !== result.terminal.id)] }));
      void queryClient.invalidateQueries({ queryKey: ["sessions", project.id] });
      setSelectedId(result.terminal.id);
      onOpenSession?.(result.session.id);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "创建终端对话失败")
  });
  const restart = useMutation({
    mutationFn: (id: string) => api<{ terminal: TerminalChatSession }>(`/api/terminal-sessions/${id}/restart`, { method: "POST" }),
    onSuccess: (result) => { update(result.terminal.id, result.terminal); toast.success("终端已重启"); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "重启终端失败")
  });
  const stop = useMutation({
    mutationFn: (id: string) => api<{ terminal: TerminalChatSession }>(`/api/terminal-sessions/${id}/stop`, { method: "POST" }),
    onSuccess: (result) => { update(result.terminal.id, result.terminal); toast.success("终端已停止"); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "停止终端失败")
  });
  const items = sessions.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? items.find((item) => item.sessionId === sessionId) ?? items[0] ?? null;
  const update = useCallback((id: string, next: Partial<TerminalChatSession>) => queryClient.setQueryData<SessionList>(["terminal-chat-sessions", project.id], (current) => current ? { items: current.items.map((item) => item.id === id ? { ...item, ...next } : item) } : current), [project.id, queryClient]);
  const configure = useMutation({
    mutationFn: (input: { id: string; restartPolicy: "manual" | "on-unexpected-exit" }) =>
      api<{ terminal: TerminalChatSession }>(`/api/terminal-sessions/${input.id}`, { method: "PUT", body: JSON.stringify({ restartPolicy: input.restartPolicy }) }),
    onSuccess: (result) => update(result.terminal.id, result.terminal),
    onError: (error) => toast.error(error instanceof Error ? error.message : "更新重启策略失败")
  });
  const remove = useMutation({
    mutationFn: (item: TerminalChatSession) => api<{ ok: boolean }>(`/api/sessions/${item.sessionId}`, { method: "DELETE" }),
    onSuccess: (_result, item) => {
      queryClient.setQueryData<SessionList>(["terminal-chat-sessions", project.id], (current) =>
        current ? { items: current.items.filter((session) => session.id !== item.id) } : current
      );
      queryClient.setQueriesData<Session[]>({ queryKey: ["sessions", project.id] }, (current) =>
        (current ?? []).filter((session) => session.id !== item.sessionId)
      );
      void queryClient.invalidateQueries({ queryKey: ["sessions", project.id] });
      void queryClient.invalidateQueries({ queryKey: ["terminal-chat-sessions", project.id] });
      void queryClient.removeQueries({ queryKey: ["session", item.sessionId] });
      const remaining = queryClient.getQueryData<SessionList>(["terminal-chat-sessions", project.id])?.items ?? [];
      if (selectedId === item.id) {
        const next = remaining[0];
        setSelectedId(next?.id ?? "");
        onOpenSession?.(next?.sessionId ?? "");
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "删除终端对话失败")
  });
  const tabLabels = useMemo(
    () => numberedDuplicateTitles(items.map((item) => ({ id: item.sessionId, title: item.title, createdAt: item.createdAt }))),
    [items]
  );
  useEffect(() => {
    const matched = items.find((item) => item.sessionId === sessionId) ?? items.find((item) => item.id === selectedId) ?? items[0];
    if (matched) {
      if (matched.id !== selectedId) setSelectedId(matched.id);
      return;
    }
    if (selectedId) setSelectedId("");
  }, [items, selectedId, sessionId]);
  useEffect(() => {
    const live = new Set(items.map((item) => item.id));
    setVisitedIds((current) => {
      const pruned = current.filter((id) => live.has(id));
      if (!selected || !live.has(selected.id)) {
        return pruned.length === current.length ? current : pruned;
      }
      const next = [selected.id, ...pruned.filter((id) => id !== selected.id)].slice(0, 8);
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [items, selected]);
  const visitedItems = items.filter((item) => item.id === selected?.id || visitedIds.includes(item.id));
  const closeTab = (item: TerminalChatSession) => {
    const running = item.state === "running" || item.desiredState === "running";
    const title = tabLabels.get(item.sessionId) ?? item.title;
    if (!window.confirm(running ? `删除终端对话「${title}」？进程会被停止。` : `删除终端对话「${title}」？`)) return;
    remove.mutate(item);
  };
  const renderTabBar = () => (
    <>
      <BotMessageSquare className="size-3.5 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex h-7 shrink-0 items-center rounded-lg border text-[11px] ${
              selected?.id === item.id
                ? "border-primary/30 bg-primary/10 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            <button
              type="button"
              className="flex h-full items-center gap-1 px-1.5"
              onClick={() => { setSelectedId(item.id); onOpenSession?.(item.sessionId); }}
            >
              <span className={`size-1.5 rounded-full ${item.state === "running" ? "bg-emerald-500" : item.state === "needs_attention" ? "bg-red-500" : "bg-muted-foreground"}`} />
              <span className="max-w-40 truncate">{tabLabels.get(item.sessionId) ?? item.title}</span>
            </button>
            <button
              type="button"
              className="grid size-6 place-items-center rounded-r-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={`关闭 ${tabLabels.get(item.sessionId) ?? item.title}`}
              disabled={remove.isPending}
              onClick={() => closeTab(item)}
            >
              <Delete className="size-3" />
            </button>
          </div>
        ))}
      </div>
      <select aria-label="选择终端 profile" className="h-7 max-w-28 rounded-lg border border-border bg-background px-1.5 text-[11px]" value="" onChange={(event) => { if (event.target.value) { create.mutate(event.target.value); event.target.value = ""; } }} disabled={create.isPending}>
        <option value="" disabled>新建</option>
        {(profiles.data?.profiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select>
      <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="新建终端对话" onClick={() => create.mutate("shell")} disabled={create.isPending}>{create.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}</Button>
      <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="刷新终端对话" onClick={() => void sessions.refetch()}><RefreshCw className={`size-3.5 ${sessions.isFetching ? "animate-spin" : ""}`} /></Button>
    </>
  );
  const sessionActions = selected ? (
    <>
      <select
        aria-label="重启策略"
        className="h-7 max-w-28 rounded-lg border border-border bg-background px-1.5 text-[11px] sm:max-w-36"
        value={selected.restartPolicy}
        disabled={configure.isPending}
        onChange={(event) => configure.mutate({ id: selected.id, restartPolicy: event.target.value as "manual" | "on-unexpected-exit" })}
      >
        <option value="manual">手动重启</option>
        <option value="on-unexpected-exit">异常退出自动重启</option>
      </select>
      <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="重启终端对话" onClick={() => restart.mutate(selected.id)}><RotateCcw className="size-3.5" /></Button>
      <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="停止终端对话" onClick={() => stop.mutate(selected.id)}><Square className="size-3.5" /></Button>
    </>
  ) : null;
  return (
    <section className="relative flex h-full min-h-0 flex-col bg-background">
      {visitedItems.length ? (
        visitedItems.map((item) => (
          <div
            key={item.id}
            className={terminalKeepaliveClassName(item.id === selected?.id)}
            aria-hidden={item.id !== selected?.id}
            {...(item.id === selected?.id ? {} : { inert: true })}
          >
            <TerminalChatViewport
              project={project}
              session={item}
              onChange={(next) => update(item.id, next)}
              active={active && item.id === selected?.id}
              tabBar={renderTabBar()}
              sessionActions={item.id === selected?.id ? sessionActions : null}
              fontSize={fontSize}
              onFontSizeChange={changeFontSize}
            />
          </div>
        ))
      ) : (
        <>
          <div className="flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-muted/70 px-2 text-[11px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {renderTabBar()}
          </div>
          <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
            <div>
              <BotMessageSquare className="mx-auto size-10 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">新建一个终端对话</p>
              <p className="mt-1 text-xs text-muted-foreground">关闭页面不会停止服务端的 CLI 进程。</p>
              <Button className="mt-4" size="sm" onClick={() => create.mutate("shell")}><Plus className="size-4" />新建终端对话</Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
