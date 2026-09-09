import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ArrowDown,
  Clipboard,
  Command,
  Copy,
  Delete,
  Download,
  Eraser,
  History as HistoryIcon,
  Keyboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Square,
  SquareTerminal
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/context/theme-provider";
import { api, terminalChatWsUrl } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { Project, Session, TerminalChatSession } from "@/types";
import { LiveDuration } from "./WorkspaceStatus";
import {
  chromePointerMovedTooFar,
  encodeTerminalKeyboardSubmit,
  filterCommandHistory,
  isCoarsePointer,
  isDuplicateChromeClick,
  isTouchLikePointer,
  joinVisibleLines,
  shouldFocusTerminalAfterChromeAction,
  shouldPreventChromePointerDefault,
  shouldSubmitTerminalKeyboard,
  terminalCopyPayload,
  attachTerminalTouchScroll,
  xtermTheme
} from "./terminal-chrome";

type SessionList = { items: TerminalChatSession[] };
type Profile = { id: string; name: string; executable: string; args: string[] };
type TerminalHistoryItem = { seq: number; kind: string; data: string; createdAt?: number };

const control = (key: string) => String.fromCharCode(key.toUpperCase().charCodeAt(0) & 31);
const chromeKeyClass =
  "inline-flex h-10 min-w-10 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground select-none active:bg-muted dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:active:bg-white/15";
const chromeIconClass =
  "inline-flex h-10 min-w-10 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-border bg-background px-2 text-foreground select-none active:bg-muted dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:active:bg-white/15";
const modifierClass = (pressed: boolean) =>
  `inline-flex h-10 min-w-14 shrink-0 touch-manipulation items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium select-none ${
    pressed
      ? "border-sky-500 bg-sky-500/15 text-sky-800 dark:border-sky-400 dark:bg-sky-400/20 dark:text-sky-100"
      : "border-border bg-background text-foreground dark:border-white/15 dark:bg-white/5 dark:text-slate-200"
  }`;

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

function TerminalChatViewport({ session, onChange }: { session: TerminalChatSession; onChange: (next: Partial<TerminalChatSession>) => void }) {
  const { resolvedTheme } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const resolvedThemeRef = useRef(resolvedTheme);
  resolvedThemeRef.current = resolvedTheme;
  const socket = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);
  const reconnect = useRef<number | null>(null);
  const attempts = useRef(0);
  const rawRef = useRef(false);
  const ctrlRef = useRef(false);
  const altRef = useRef(false);
  const shiftRef = useRef(false);
  const stickyRef = useRef({ ctrl: false, alt: false, shift: false });
  const onChangeRef = useRef(onChange);
  const outputRef = useRef("");
  const firstSeqRef = useRef(1);
  const pageVisibleRef = useRef(document.visibilityState === "visible");
  const lastPointerType = useRef<string | undefined>(undefined);
  const chromePointerStartX = useRef(0);
  const pasteAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const lineRef = useRef<HTMLTextAreaElement | null>(null);
  const historyPanelRef = useRef<HTMLDivElement | null>(null);
  const historyButtonRef = useRef<HTMLSpanElement | null>(null);
  const lineComposing = useRef(false);
  const [connected, setConnected] = useState(false);
  const [raw, setRaw] = useState(false);
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
  const [shortcutDockOpen, setShortcutDockOpen] = useState(false);

  const sendRaw = useCallback((data: string) => {
    if (!data) return;
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "terminal.input", terminalId: session.id, data }));
  }, [session.id]);

  const sendInput = useCallback((rawData: string, applyLatchedModifiers = true) => {
    let data = rawData;
    if (applyLatchedModifiers && shiftRef.current) {
      const arrows: Record<string, string> = {
        "\x1b[A": "\x1b[1;2A",
        "\x1b[B": "\x1b[1;2B",
        "\x1b[C": "\x1b[1;2C",
        "\x1b[D": "\x1b[1;2D"
      };
      if (arrows[rawData]) data = arrows[rawData];
      else if (rawData.length === 1) data = rawData.toUpperCase();
    }
    if (applyLatchedModifiers && ctrlRef.current && data.length === 1) data = control(data);
    if (applyLatchedModifiers && altRef.current) data = `\x1b${data}`;
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

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { ctrlRef.current = ctrl; }, [ctrl]);
  useEffect(() => { altRef.current = alt; }, [alt]);
  useEffect(() => { shiftRef.current = shift; }, [shift]);
  useEffect(() => { stickyRef.current = sticky; }, [sticky]);
  useEffect(() => {
    rawRef.current = raw;
    if (terminal.current) terminal.current.options.disableStdin = !raw;
  }, [raw]);
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
    setHistoryOpen((open) => {
      if (!open) void loadCommandHistory();
      return !open;
    });
  };
  const applyHistory = (item: string) => {
    setDraft(item);
    setHistoryOpen(false);
    setHistoryQuery("");
    window.setTimeout(() => {
      lineRef.current?.focus();
      const length = item.length;
      lineRef.current?.setSelectionRange(length, length);
    }, 0);
  };

  useEffect(() => {
    if (!historyOpen) return;
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyPanelRef.current?.contains(target) || historyButtonRef.current?.contains(target)) return;
      setHistoryOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHistoryOpen(false);
      setHistoryQuery("");
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [historyOpen]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const instance = new Terminal({
      cursorBlink: true,
      fontSize: window.innerWidth < 640 ? 12 : 13,
      lineHeight: 1.2,
      scrollback: 5000,
      disableStdin: true,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      theme: xtermTheme(resolvedThemeRef.current)
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(element);
    terminal.current = instance;
    instance.options.disableStdin = !rawRef.current;
    const detachTouchScroll = attachTerminalTouchScroll(element, () => terminal.current);
    const fitTerminal = () => {
      try {
        fit.fit();
        if (socket.current?.readyState === WebSocket.OPEN) {
          socket.current.send(JSON.stringify({ type: "terminal.resize", terminalId: session.id, cols: instance.cols, rows: instance.rows }));
        }
      } catch {
        // Hidden while switching workspace tabs.
      }
    };
    const observer = new ResizeObserver(fitTerminal);
    observer.observe(element);
    const dataSubscription = instance.onData((data) => {
      if (rawRef.current) sendInput(data);
    });
    const scrollSubscription = instance.onScroll(() => {
      const buffer = instance.buffer.active;
      setAtBottom(buffer.viewportY >= buffer.baseY);
    });
    let disposed = false;
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
          if (!message.payload?.replay) {
            instance.reset();
            outputRef.current = String(message.payload?.output ?? "");
          } else if (message.payload?.output) {
            outputRef.current += String(message.payload.output);
          }
          if (message.payload?.output) instance.write(String(message.payload.output));
          if (typeof message.payload?.firstSeq === "number") {
            firstSeqRef.current = message.payload.firstSeq;
            setFirstSeq(message.payload.firstSeq);
          }
          if (typeof message.seq === "number") lastSeq.current = message.seq;
          if (message.payload?.terminal) applyChange(message.payload.terminal);
          if (message.payload?.truncated) instance.write("\r\n\x1b[90m[仅显示最近输出，可加载更早历史]\x1b[0m\r\n");
        } else if (message.type === "terminal.output") {
          if (typeof message.seq === "number" && message.seq <= lastSeq.current) return;
          instance.write(String(message.payload?.data ?? ""));
          outputRef.current = `${outputRef.current}${String(message.payload?.data ?? "")}`.slice(-4 * 1024 * 1024);
          if (typeof message.seq === "number") lastSeq.current = message.seq;
        } else if (message.type === "terminal.exit") {
          applyChange({ state: "exited", pid: null, lastExitCode: message.payload?.exitCode ?? null });
          instance.write("\r\n\x1b[90m[进程已退出]\x1b[0m\r\n");
        } else if (message.type === "terminal.state") applyChange(message.payload ?? {});
        else if (message.type === "terminal.marker") {
          const marker = `\r\n\x1b[90m[${String(message.payload?.text ?? "状态更新")}]\x1b[0m\r\n`;
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
      detachTouchScroll();
      dataSubscription.dispose();
      scrollSubscription.dispose();
      socket.current?.close();
      instance.dispose();
      terminal.current = null;
    };
  }, [sendInput, session.id]);

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = xtermTheme(resolvedTheme);
  }, [resolvedTheme]);

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
  const shortcut = (label: string, data: string, title?: string, repeat = false) => (
    <button type="button" className={chromeKeyClass} title={title ?? label} aria-label={title ?? label} {...chromeActivateProps(() => { sendInput(data, false); focusTerminalIfAppropriate(); }, repeat)}>
      {label}
    </button>
  );
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
  const openPasteOverlay = () => {
    setPasteDraft("");
    setPasteOpen(true);
  };
  const pasteIntoTerminal = () => {
    if (navigator.clipboard?.readText) {
      void navigator.clipboard.readText().then((value) => {
        if (value) {
          sendInput(value, false);
          focusTerminalIfAppropriate();
          return;
        }
        openPasteOverlay();
      }).catch(() => openPasteOverlay());
      return;
    }
    openPasteOverlay();
  };
  const submitPasteOverlay = () => {
    const value = pasteDraft;
    setPasteOpen(false);
    setPasteDraft("");
    if (value) sendInput(value, false);
    focusTerminalIfAppropriate();
  };
  const submitLine = () => {
    if (lineComposing.current || !draft.trim()) return;
    rememberCommand(draft);
    sendRaw(encodeTerminalKeyboardSubmit(draft));
    setDraft("");
    setHistoryOpen(false);
    setHistoryQuery("");
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

  const shortcutControls = (
    <>
      <button type="button" className={modifierClass(ctrl)} aria-pressed={ctrl} title={sticky.ctrl ? "Ctrl 连续锁定" : "Ctrl"} {...modifierButtonProps("ctrl")}>Ctrl{sticky.ctrl ? " *" : ""}</button>
      <button type="button" className={modifierClass(alt)} aria-pressed={alt} title={sticky.alt ? "Alt 连续锁定" : "Alt"} {...modifierButtonProps("alt")}><Command className="size-3.5" /> Alt{sticky.alt ? " *" : ""}</button>
      <button type="button" className={modifierClass(shift)} aria-pressed={shift} title={sticky.shift ? "Shift 连续锁定" : "Shift"} {...modifierButtonProps("shift")}>Shift{sticky.shift ? " *" : ""}</button>
      {shortcut("Esc", "\x1b")}
      {shortcut("Tab", "\t")}
      {shortcut("←", "\x1b[D", "方向左", true)}
      {shortcut("↑", "\x1b[A", "方向上", true)}
      {shortcut("↓", "\x1b[B", "方向下", true)}
      {shortcut("→", "\x1b[C", "方向右", true)}
      {shortcut("Home", "\x1b[H")}
      {shortcut("End", "\x1b[F")}
      {(["C", "D", "Z", "L"] as const).map((key) => shortcut(`^${key}`, control(key), `Ctrl+${key}`))}
    </>
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background text-foreground dark:bg-[#090d14] dark:text-slate-100">
      <div className="relative flex min-h-10 shrink-0 items-center gap-2 border-b border-border bg-muted px-3 text-[11px] text-muted-foreground dark:border-white/10 dark:bg-slate-950 dark:text-slate-300">
        <span className={`size-2 rounded-full ${connected ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`} />
        <span className="min-w-0 truncate">{statusLabel(session, connected)}</span>
        {session.state === "running" ? (
          <span className="hidden shrink-0 sm:inline">
            · 时长 <LiveDuration startedAt={session.createdAt} />
          </span>
        ) : null}
        <span className="ml-auto hidden max-w-[30%] truncate font-mono dark:text-slate-500 sm:block" title={session.cwd}>{session.cwd}</span>
        <button type="button" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent dark:text-slate-300 dark:hover:bg-white/10" aria-label="搜索终端历史" {...chromeActivateProps(() => setSearchOpen((value) => !value))}>
          <Search className="size-3.5" />
        </button>
        <button type="button" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent dark:text-slate-300 dark:hover:bg-white/10" aria-label="下载终端输出" {...chromeActivateProps(downloadLog)}>
          <Download className="size-3.5" />
        </button>
        {searchOpen && (
          <form className="absolute right-2 top-10 z-20 w-[min(22rem,calc(100vw-1rem))] rounded-lg border border-border bg-card p-2 shadow-xl dark:border-white/15 dark:bg-slate-900" onSubmit={runSearch}>
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
      <div className="relative min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
        <div ref={host} className="h-full touch-none overscroll-contain" />
        {pasteOpen ? (
          <div className="absolute inset-x-2 bottom-2 z-10 rounded-lg border border-border bg-background p-3 shadow-lg dark:border-white/10 dark:bg-[#090d14]">
            <label className="mb-1.5 block text-xs text-muted-foreground" htmlFor="terminal-chat-paste-input">粘贴到终端</label>
            <textarea
              id="terminal-chat-paste-input"
              ref={pasteAreaRef}
              value={pasteDraft}
              autoFocus
              rows={4}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="长按此处粘贴"
              onChange={(event) => setPasteDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setPasteOpen(false);
                }
              }}
              className="h-24 w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none dark:border-white/15 dark:bg-white/5 dark:text-slate-100"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" {...chromeActivateProps(() => { setPasteOpen(false); setPasteDraft(""); })}>取消</Button>
              <Button type="button" size="sm" {...chromeActivateProps(submitPasteOverlay)}>发送</Button>
            </div>
          </div>
        ) : null}
        {!atBottom && (
          <button type="button" className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-lg border border-border bg-card/90 text-foreground shadow-lg dark:border-white/15 dark:bg-slate-900/90 dark:text-slate-100" aria-label="回到底部" onClick={() => { terminal.current?.scrollToBottom(); setAtBottom(true); }}>
            <ArrowDown className="size-4" />
          </button>
        )}
        {firstSeq > 1 && (
          <button type="button" className="absolute left-3 top-3 rounded-lg border border-border bg-card/90 px-2.5 py-1.5 text-xs text-foreground dark:border-white/15 dark:bg-slate-900/90 dark:text-slate-200" onClick={() => void loadEarlier()} disabled={loadingEarlier}>
            {loadingEarlier ? "加载中" : "加载更早输出"}
          </button>
        )}
      </div>
      <div className="composer-dock shrink-0 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 sm:px-5 sm:pb-3">
        <div className="composer-shell overflow-visible rounded-2xl p-3">
          <div className="relative">
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
              placeholder="输入命令，Enter 发送，Shift+Enter 换行"
              aria-label="终端命令"
              inputMode="text"
              enterKeyHint="send"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              lang="zh-CN"
              className="max-h-40 min-h-12 w-full resize-none border-0 bg-transparent px-2 py-1 font-mono text-base leading-6 shadow-none outline-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent sm:min-h-14 sm:text-sm"
              onChange={(event) => setDraft(event.target.value)}
              onCompositionStart={() => { lineComposing.current = true; }}
              onCompositionEnd={() => { lineComposing.current = false; }}
              onKeyDown={(event) => {
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
                className="composer-runtime-btn h-8 rounded-lg px-2.5"
                aria-pressed={raw}
                title={raw ? "直通：按键直接进入终端" : "命令行：在输入框发送完整命令"}
                {...chromeActivateProps(() => setRaw((value) => !value))}
              >
                <Keyboard className="size-3.5" />
                <span>{raw ? "直通" : "命令行"}</span>
              </Button>
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
                {shortcutControls}
                <button type="button" className={chromeIconClass} title="复制" aria-label="复制终端内容" {...chromeActivateProps(copyFromTerminal)}>
                  <Copy className="size-4" />
                </button>
                <button type="button" className={chromeIconClass} title="粘贴" aria-label="粘贴" {...chromeActivateProps(pasteIntoTerminal)}>
                  <Clipboard className="size-4" />
                </button>
                <button type="button" className={chromeIconClass} title="清屏（Ctrl+L）" aria-label="清屏" {...chromeActivateProps(() => { sendInput("\x0c", false); focusTerminalIfAppropriate(); })}>
                  <Eraser className="size-4" />
                </button>
              </div>
            </div>
            <div className="composer-actions">
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
              <Button type="button" size="icon" className="size-8 rounded-lg" aria-label="发送到终端" onClick={submitLine} disabled={!draft.trim()}>
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="group absolute right-0 top-1/2 z-20 hidden -translate-y-1/2 md:block">
        <button type="button" className="grid size-9 place-items-center rounded-l-lg border border-r-0 border-border/80 bg-card/95 text-muted-foreground shadow-lg backdrop-blur hover:bg-muted dark:border-white/15 dark:bg-slate-900/95" aria-label="显示快捷键" title="显示快捷键" onClick={() => setShortcutDockOpen((value) => !value)}>
          <Keyboard className="size-4" />
        </button>
        <div className={`absolute right-9 top-0 flex max-h-[min(28rem,70vh)] -translate-y-0 flex-col items-center gap-1 overflow-y-auto rounded-l-xl border border-r-0 border-border/80 bg-card/95 p-1 shadow-lg backdrop-blur transition dark:border-white/15 dark:bg-slate-900/95 ${shortcutDockOpen ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-2 opacity-0 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100"}`}>
          {shortcutControls}
        </div>
      </div>
    </div>
  );
}

export function TerminalChatPanel({ project, sessionId = "", onOpenSession }: { project: Project; sessionId?: string; onOpenSession?: (sessionId: string) => void }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
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
  const selectedChange = useCallback((next: Partial<TerminalChatSession>) => {
    if (selected) update(selected.id, next);
  }, [selected, update]);
  useEffect(() => {
    const matched = items.find((item) => item.sessionId === sessionId) ?? items.find((item) => item.id === selectedId) ?? items[0];
    if (matched) {
      if (matched.id !== selectedId) setSelectedId(matched.id);
      return;
    }
    if (selectedId) setSelectedId("");
  }, [items, selectedId, sessionId]);
  const closeTab = (item: TerminalChatSession) => {
    const running = item.state === "running" || item.desiredState === "running";
    if (!window.confirm(running ? `删除终端对话「${item.title}」？进程会被停止。` : `删除终端对话「${item.title}」？`)) return;
    remove.mutate(item);
  };
  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-3">
        <SquareTerminal className="size-4 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex h-8 shrink-0 items-center rounded-lg border text-xs ${
                selected?.id === item.id
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent"
              }`}
            >
              <button
                type="button"
                className="flex h-full items-center gap-1.5 px-2"
                onClick={() => { setSelectedId(item.id); onOpenSession?.(item.sessionId); }}
              >
                <span className={`size-1.5 rounded-full ${item.state === "running" ? "bg-emerald-500" : item.state === "needs_attention" ? "bg-red-500" : "bg-muted-foreground"}`} />
                <span className="max-w-28 truncate">{item.title}</span>
              </button>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-r-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`关闭 ${item.title}`}
                disabled={remove.isPending}
                onClick={() => closeTab(item)}
              >
                <Delete className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <select aria-label="选择终端 profile" className="h-8 max-w-36 rounded-lg border border-border bg-background px-2 text-xs" value="" onChange={(event) => { if (event.target.value) { create.mutate(event.target.value); event.target.value = ""; } }} disabled={create.isPending}>
          <option value="" disabled>新建终端</option>
          {(profiles.data?.profiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="新建终端对话" onClick={() => create.mutate("shell")} disabled={create.isPending}>{create.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}</Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="刷新终端对话" onClick={() => void sessions.refetch()}><RefreshCw className={`size-4 ${sessions.isFetching ? "animate-spin" : ""}`} /></Button>
      </div>
      {selected ? (
        <>
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
            <span className="truncate">{selected.title} · {selected.profileId}</span>
            {selected.state === "needs_attention" ? <span className="text-destructive">已暂停自动重启</span> : <span>{selected.state}</span>}
            <select
              aria-label="重启策略"
              className="ml-auto h-7 max-w-40 rounded-lg border border-border bg-background px-2 text-xs"
              value={selected.restartPolicy}
              disabled={configure.isPending}
              onChange={(event) => configure.mutate({ id: selected.id, restartPolicy: event.target.value as "manual" | "on-unexpected-exit" })}
            >
              <option value="manual">手动重启</option>
              <option value="on-unexpected-exit">异常退出自动重启</option>
            </select>
            <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="重启终端对话" onClick={() => restart.mutate(selected.id)}><RotateCcw className="size-3.5" /></Button>
            <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="停止终端对话" onClick={() => stop.mutate(selected.id)}><Square className="size-3.5" /></Button>
            <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="删除终端对话" onClick={() => closeTab(selected)} disabled={remove.isPending}><Delete className="size-3.5" /></Button>
          </div>
          <TerminalChatViewport key={selected.id} session={selected} onChange={selectedChange} />
        </>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
          <div>
            <SquareTerminal className="mx-auto size-10 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">新建一个终端对话</p>
            <p className="mt-1 text-xs text-muted-foreground">关闭页面不会停止服务端的 CLI 进程。</p>
            <Button className="mt-4" size="sm" onClick={() => create.mutate("shell")}><Plus className="size-4" />新建终端对话</Button>
          </div>
        </div>
      )}
    </section>
  );
}
