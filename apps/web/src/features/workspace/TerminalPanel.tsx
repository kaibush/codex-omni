import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  Clipboard,
  Command,
  Copy,
  Delete,
  Download,
  Eraser,
  Keyboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  SquareTerminal
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/theme-provider";
import { api, terminalWsUrl } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { Project, ProjectTerminal } from "@/types";

type TerminalList = { host: string; items: ProjectTerminal[] };
type SocketState = "connecting" | "connected" | "reconnecting" | "disconnected";

const controlCharacter = (key: string) => {
  const value = key.toUpperCase().charCodeAt(0);
  return String.fromCharCode(value & 31);
};

function TerminalViewport({
  terminal,
  onTerminalChange
}: {
  terminal: ProjectTerminal;
  onTerminalChange: (terminalId: string, next: Partial<ProjectTerminal>) => void;
}) {
  const { resolvedTheme } = useTheme();
  const host = useRef<HTMLDivElement | null>(null);
  const xterm = useRef<Terminal | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);
  const pendingInput = useRef("");
  const reconnectTimer = useRef<number | null>(null);
  const reconnectAttempt = useRef(0);
  const ctrlRef = useRef(false);
  const altRef = useRef(false);
  const shiftRef = useRef(false);
  const stickyRef = useRef({ ctrl: false, alt: false, shift: false });
  const [ctrl, setCtrl] = useState(false);
  const [alt, setAlt] = useState(false);
  const [shift, setShift] = useState(false);
  const [sticky, setSticky] = useState({ ctrl: false, alt: false, shift: false });
  const [connection, setConnection] = useState<SocketState>("connecting");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<number[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);

  useEffect(() => {
    ctrlRef.current = ctrl;
  }, [ctrl]);
  useEffect(() => {
    altRef.current = alt;
  }, [alt]);
  useEffect(() => {
    shiftRef.current = shift;
  }, [shift]);
  useEffect(() => {
    stickyRef.current = sticky;
  }, [sticky]);

  const sendInput = useCallback(
    (raw: string, applyLatchedModifiers = true) => {
      let data = raw;
      if (applyLatchedModifiers && shiftRef.current) {
        const arrows: Record<string, string> = {
          "\x1b[A": "\x1b[1;2A",
          "\x1b[B": "\x1b[1;2B",
          "\x1b[C": "\x1b[1;2C",
          "\x1b[D": "\x1b[1;2D"
        };
        if (arrows[raw]) data = arrows[raw];
        else if (raw.length === 1) data = raw.toUpperCase();
      }
      if (applyLatchedModifiers && ctrlRef.current && data.length === 1) {
        data = controlCharacter(data);
      }
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
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal.input", terminalId: terminal.id, data }));
        return;
      }
      pendingInput.current = `${pendingInput.current}${data}`.slice(-64 * 1024);
    },
    [terminal.id]
  );

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    lastSeq.current = 0;
    pendingInput.current = "";
    const instance = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      convertEol: false,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: window.innerWidth < 640 ? 12 : 13,
      lineHeight: 1.2,
      scrollback: 10_000,
      allowTransparency: false,
      theme:
        resolvedTheme === "dark"
          ? {
              background: "#090d14",
              foreground: "#dce5f2",
              cursor: "#7dd3fc",
              selectionBackground: "#1d4ed880"
            }
          : {
              background: "#fbfdff",
              foreground: "#172033",
              cursor: "#0369a1",
              selectionBackground: "#93c5fd80"
            }
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(element);
    xterm.current = instance;
    const fitAndResize = () => {
      try {
        fit.fit();
        const ws = socket.current;
        if (ws?.readyState === WebSocket.OPEN && instance.cols >= 20 && instance.rows >= 5) {
          ws.send(
            JSON.stringify({
              type: "terminal.resize",
              terminalId: terminal.id,
              cols: instance.cols,
              rows: instance.rows
            })
          );
        }
      } catch {
        // The terminal can be momentarily hidden while switching workspace tabs.
      }
    };
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(element);
    const dataSubscription = instance.onData((data) => sendInput(data));
    window.setTimeout(() => {
      fitAndResize();
      instance.focus();
    }, 0);

    let disposed = false;
    const connect = () => {
      if (disposed) return;
      setConnection(reconnectAttempt.current ? "reconnecting" : "connecting");
      const ws = new WebSocket(terminalWsUrl());
      socket.current = ws;
      ws.onopen = () => {
        if (disposed) return;
        reconnectAttempt.current = 0;
        setConnection("connected");
        ws.send(
          JSON.stringify({
            type: "terminal.subscribe",
            terminalId: terminal.id,
            lastSeq: lastSeq.current
          })
        );
        fitAndResize();
        if (pendingInput.current) {
          ws.send(
            JSON.stringify({
              type: "terminal.input",
              terminalId: terminal.id,
              data: pendingInput.current
            })
          );
          pendingInput.current = "";
        }
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.terminalId && message.terminalId !== terminal.id) return;
        if (message.type === "terminal.snapshot") {
          if (!message.payload?.replay) {
            instance.reset();
            if (message.payload?.output) instance.write(String(message.payload.output));
          }
          if (typeof message.seq === "number") lastSeq.current = message.seq;
          if (message.payload?.terminal) onTerminalChange(terminal.id, message.payload.terminal);
        } else if (message.type === "terminal.output") {
          if (typeof message.seq === "number" && message.seq <= lastSeq.current) return;
          instance.write(String(message.payload?.data ?? ""));
          if (typeof message.seq === "number") lastSeq.current = message.seq;
        } else if (message.type === "terminal.exit") {
          onTerminalChange(terminal.id, {
            status: "exited",
            exitCode: message.payload?.exitCode ?? null,
            signal: message.payload?.signal ?? null,
            exitedAt: message.payload?.exitedAt ?? Date.now()
          });
          instance.write(
            `\r\n\x1b[90m[进程已退出：${message.payload?.exitCode ?? message.payload?.signal ?? "unknown"}]\x1b[0m\r\n`
          );
        } else if (message.type === "terminal.error") {
          instance.write(
            `\r\n\x1b[31m${String(message.payload?.message ?? "终端连接错误")}\x1b[0m\r\n`
          );
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        socket.current = null;
        reconnectAttempt.current += 1;
        setConnection(reconnectAttempt.current >= 5 ? "disconnected" : "reconnecting");
        reconnectTimer.current = window.setTimeout(
          connect,
          Math.min(8000, 800 * 2 ** Math.min(reconnectAttempt.current - 1, 4))
        );
      };
      ws.onerror = () => {
        if (!disposed) setConnection("reconnecting");
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      resizeObserver.disconnect();
      dataSubscription.dispose();
      const ws = socket.current;
      socket.current = null;
      if (ws?.readyState === WebSocket.OPEN) ws.close();
      else if (ws?.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
      instance.dispose();
      xterm.current = null;
    };
  }, [onTerminalChange, resolvedTheme, sendInput, terminal.id]);

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

  const readBufferLines = () => {
    const buffer = xterm.current?.buffer.active;
    if (!buffer) return [];
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
    }
    return lines;
  };

  const jumpSearch = (hits: number[], index: number) => {
    const line = hits[index];
    if (line == null) return;
    xterm.current?.scrollToLine(line);
    setSearchIndex(index);
  };

  const runSearch = (value: string) => {
    setSearchQuery(value);
    const needle = value.trim().toLowerCase();
    if (!needle) {
      setSearchHits([]);
      setSearchIndex(0);
      return;
    }
    const hits = readBufferLines()
      .map((line, index) => (line.toLowerCase().includes(needle) ? index : -1))
      .filter((index) => index >= 0);
    setSearchHits(hits);
    jumpSearch(hits, 0);
  };

  const shortcut = (label: string, data: string, title?: string, repeat = false) => {
    const send = () => {
      sendInput(data, false);
      xterm.current?.focus();
    };
    return (
      <button
        type="button"
        className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-2 text-xs font-medium text-slate-200 active:bg-white/15"
        onClick={repeat ? undefined : send}
        onPointerDown={
          repeat
            ? (event) => {
                event.preventDefault();
                send();
                const hold = window.setTimeout(() => {
                  const timer = window.setInterval(send, 50);
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
              }
            : undefined
        }
        title={title ?? label}
        aria-label={title ?? label}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#090d14] dark:bg-[#090d14]">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-white/10 bg-slate-950 px-3 text-[11px] text-slate-300">
        <span
          className={`size-2 rounded-full ${
            connection === "connected"
              ? "bg-emerald-400"
              : connection === "disconnected"
                ? "bg-red-400"
                : "animate-pulse bg-amber-400"
          }`}
        />
        <span>
          {connection === "connected"
            ? `已连接 · PID ${terminal.pid ?? "—"}`
            : connection === "disconnected"
              ? "连接暂未恢复，仍会自动重试"
              : "正在恢复终端连接"}
        </span>
        <span
          className="ml-auto hidden truncate font-mono text-slate-500 sm:block"
          title={terminal.cwd}
        >
          {terminal.cwd}
        </span>
        <button
          type="button"
          className="grid size-7 place-items-center rounded-md text-slate-300 hover:bg-white/10"
          aria-label="搜索终端输出"
          onClick={() => setSearchOpen((value) => !value)}
        >
          <Search className="size-3.5" />
        </button>
        <button
          type="button"
          className="grid size-7 place-items-center rounded-md text-slate-300 hover:bg-white/10"
          aria-label="下载终端输出"
          onClick={() => {
            const blob = new Blob([readBufferLines().join("\n")], {
              type: "text/plain;charset=utf-8"
            });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${terminal.name || "terminal"}.log`;
            document.body.append(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
          }}
        >
          <Download className="size-3.5" />
        </button>
      </div>
      {searchOpen ? (
        <div className="flex items-center gap-2 border-b border-white/10 bg-slate-950 px-3 py-2">
          <input
            value={searchQuery}
            onChange={(event) => runSearch(event.target.value)}
            placeholder="搜索终端输出"
            className="h-8 min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2 text-xs text-slate-100 outline-none"
          />
          <span className="text-[10px] text-slate-400">
            {searchHits.length ? `${searchIndex + 1}/${searchHits.length}` : "无匹配"}
          </span>
          <button
            type="button"
            className="text-xs text-slate-300"
            onClick={() =>
              jumpSearch(
                searchHits,
                (searchIndex - 1 + searchHits.length) % Math.max(searchHits.length, 1)
              )
            }
          >
            上一个
          </button>
          <button
            type="button"
            className="text-xs text-slate-300"
            onClick={() =>
              jumpSearch(searchHits, (searchIndex + 1) % Math.max(searchHits.length, 1))
            }
          >
            下一个
          </button>
        </div>
      ) : null}
      <div ref={host} className="min-h-0 flex-1 overflow-hidden p-2 sm:p-3" />
      <div className="shrink-0 border-t border-white/10 bg-slate-950 px-2 py-2 pb-[max(.5rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            className={`inline-flex h-10 min-w-14 shrink-0 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium ${
              ctrl
                ? "border-sky-400 bg-sky-400/20 text-sky-100"
                : "border-white/15 bg-white/5 text-slate-200"
            }`}
            aria-pressed={ctrl}
            title={sticky.ctrl ? "Ctrl 连续锁定" : "Ctrl latch"}
            onClick={() => toggleModifier("ctrl")}
            onDoubleClick={() => toggleModifier("ctrl", true)}
          >
            <Keyboard className="size-3.5" /> Ctrl{sticky.ctrl ? " *" : ""}
          </button>
          <button
            type="button"
            className={`inline-flex h-10 min-w-14 shrink-0 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium ${
              alt
                ? "border-sky-400 bg-sky-400/20 text-sky-100"
                : "border-white/15 bg-white/5 text-slate-200"
            }`}
            aria-pressed={alt}
            title={sticky.alt ? "Alt 连续锁定" : "Alt latch"}
            onClick={() => toggleModifier("alt")}
            onDoubleClick={() => toggleModifier("alt", true)}
          >
            <Command className="size-3.5" /> Alt{sticky.alt ? " *" : ""}
          </button>
          <button
            type="button"
            className={`inline-flex h-10 min-w-14 shrink-0 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium ${
              shift
                ? "border-sky-400 bg-sky-400/20 text-sky-100"
                : "border-white/15 bg-white/5 text-slate-200"
            }`}
            aria-pressed={shift}
            title={sticky.shift ? "Shift 连续锁定" : "Shift latch"}
            onClick={() => toggleModifier("shift")}
            onDoubleClick={() => toggleModifier("shift", true)}
          >
            Shift{sticky.shift ? " *" : ""}
          </button>
          {shortcut("Esc", "\x1b")}
          {shortcut("Tab", "\t")}
          {shortcut("←", "\x1b[D", "方向左", true)}
          {shortcut("↑", "\x1b[A", "方向上", true)}
          {shortcut("↓", "\x1b[B", "方向下", true)}
          {shortcut("→", "\x1b[C", "方向右", true)}
          {shortcut("Home", "\x1b[H")}
          {shortcut("End", "\x1b[F")}
          {(["C", "D", "Z", "L", "A", "E", "R", "W", "U", "K"] as const).map((key) =>
            shortcut(`^${key}`, controlCharacter(key), `Ctrl+${key}`)
          )}
          <button
            type="button"
            className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-2 text-slate-200"
            title="复制选中内容"
            aria-label="复制选中内容"
            onClick={() => {
              const selection = xterm.current?.getSelection() ?? "";
              if (selection) void copyTextToClipboard(selection);
              xterm.current?.focus();
            }}
          >
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-2 text-slate-200"
            title="粘贴"
            aria-label="粘贴"
            onClick={() => {
              if (navigator.clipboard?.readText) {
                void navigator.clipboard
                  .readText()
                  .then((value) => value && sendInput(value, false))
                  .catch(() => {
                    const value = window.prompt("粘贴到终端");
                    if (value) sendInput(value, false);
                  });
              } else {
                const value = window.prompt("粘贴到终端");
                if (value) sendInput(value, false);
              }
              xterm.current?.focus();
            }}
          >
            <Clipboard className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-2 text-slate-200"
            title="清屏（Ctrl+L）"
            aria-label="清屏"
            onClick={() => sendInput("\x0c", false)}
          >
            <Eraser className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function TerminalPanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const terminals = useQuery({
    queryKey: ["terminals", project.id],
    queryFn: () => api<TerminalList>(`/api/projects/${project.id}/terminals`),
    refetchInterval: 5000
  });
  const create = useMutation({
    mutationFn: () =>
      api<ProjectTerminal>(`/api/projects/${project.id}/terminals`, {
        method: "POST",
        body: JSON.stringify({})
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<TerminalList>(["terminals", project.id], (current) => ({
        host: current?.host ?? location.hostname,
        items: [...(current?.items ?? []), created]
      }));
      setSelectedId(created.id);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "创建终端失败")
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/terminals/${id}`, { method: "DELETE" }),
    onSuccess: (_result, id) => {
      const remaining = (terminals.data?.items ?? []).filter((terminal) => terminal.id !== id);
      queryClient.setQueryData<TerminalList>(["terminals", project.id], (current) => ({
        host: current?.host ?? location.hostname,
        items: remaining
      }));
      if (selectedId === id) setSelectedId(remaining[0]?.id ?? "");
    }
  });
  const items = terminals.data?.items ?? [];
  const selected = items.find((terminal) => terminal.id === selectedId) ?? items[0] ?? null;

  useEffect(() => {
    if (!selectedId && items[0]) setSelectedId(items[0].id);
    if (selectedId && items.length && !items.some((terminal) => terminal.id === selectedId))
      setSelectedId(items[0]?.id ?? "");
  }, [items, selectedId]);

  const updateTerminal = useCallback(
    (terminalId: string, next: Partial<ProjectTerminal>) => {
      queryClient.setQueryData<TerminalList>(["terminals", project.id], (current) =>
        current
          ? {
              ...current,
              items: current.items.map((terminal) =>
                terminal.id === terminalId ? { ...terminal, ...next } : terminal
              )
            }
          : current
      );
    },
    [project.id, queryClient]
  );

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-3">
        <SquareTerminal className="ml-1 size-4 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((terminal) => (
            <div
              key={terminal.id}
              className={`flex h-8 shrink-0 items-center rounded-lg border text-xs ${
                selected?.id === terminal.id
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent"
              }`}
            >
              <button
                type="button"
                className="flex h-full items-center gap-1.5 px-2"
                onClick={() => setSelectedId(terminal.id)}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    terminal.status === "running" ? "bg-emerald-500" : "bg-muted-foreground"
                  }`}
                />
                <span className="max-w-28 truncate">{terminal.name}</span>
              </button>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-r-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`关闭 ${terminal.name}`}
                onClick={() => {
                  if (
                    terminal.status === "running" &&
                    !window.confirm(`结束「${terminal.name}」？`)
                  )
                    return;
                  remove.mutate(terminal.id);
                }}
              >
                <Delete className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          aria-label="新建终端"
        >
          {create.isPending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          onClick={() => void terminals.refetch()}
          aria-label="刷新终端列表"
        >
          <RefreshCw className={`size-4 ${terminals.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {terminals.isPending ? (
        <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin" /> 正在读取终端
          </span>
        </div>
      ) : selected ? (
        <TerminalViewport key={selected.id} terminal={selected} onTerminalChange={updateTerminal} />
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
          <div>
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <SquareTerminal className="size-6" />
            </span>
            <h2 className="mt-4 text-sm font-semibold">打开工程终端</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              终端进程在 Server 中持续运行，刷新或临时断网后会重新接入。
            </p>
            <Button
              className="mt-4"
              size="sm"
              onClick={() => create.mutate()}
              disabled={create.isPending}
            >
              {create.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              新建终端
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
