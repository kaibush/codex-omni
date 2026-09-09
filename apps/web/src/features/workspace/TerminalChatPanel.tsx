import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ArrowDown, Keyboard, LoaderCircle, Plus, RefreshCw, RotateCcw, SquareTerminal, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, terminalChatWsUrl } from "@/lib/api";
import type { Project, Session, TerminalChatSession } from "@/types";

type SessionList = { items: TerminalChatSession[] };
type Profile = { id: string; name: string; executable: string; args: string[] };
type TerminalHistoryItem = { seq: number; kind: string; data: string };

const control = (key: string) => String.fromCharCode(key.toUpperCase().charCodeAt(0) & 31);

function TerminalChatViewport({ session, onChange }: { session: TerminalChatSession; onChange: (next: Partial<TerminalChatSession>) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);
  const reconnect = useRef<number | null>(null);
  const attempts = useRef(0);
  const rawRef = useRef(false);
  const ctrlRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const outputRef = useRef("");
  const firstSeqRef = useRef(1);
  const pageVisibleRef = useRef(document.visibilityState === "visible");
  const [connected, setConnected] = useState(false);
  const [raw, setRaw] = useState(false);
  const [draft, setDraft] = useState("");
  const [ctrl, setCtrl] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [firstSeq, setFirstSeq] = useState(1);

  const send = useCallback((data: string) => {
    if (!data) return;
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "terminal.input", terminalId: session.id, data }));
  }, [session.id]);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const instance = new Terminal({ cursorBlink: true, fontSize: window.innerWidth < 640 ? 12 : 13, lineHeight: 1.2, scrollback: 5000, disableStdin: false, fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace', theme: { background: "#090d14", foreground: "#dce5f2", cursor: "#7dd3fc", selectionBackground: "#1d4ed880" } });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(element);
    terminal.current = instance;
    const fitTerminal = () => {
      fit.fit();
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: "terminal.resize", terminalId: session.id, cols: instance.cols, rows: instance.rows }));
    };
    const observer = new ResizeObserver(fitTerminal);
    observer.observe(element);
    const dataSubscription = instance.onData((data) => { if (rawRef.current) send(ctrlRef.current && data.length === 1 ? control(data) : data); });
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
      ws.onopen = () => { attempts.current = 0; setConnected(true); ws.send(JSON.stringify({ type: "terminal.subscribe", terminalId: session.id, lastSeq: lastSeq.current })); fitTerminal(); };
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
          if (message.payload?.output && !message.payload?.replay) instance.write(String(message.payload.output));
          else if (message.payload?.output) instance.write(String(message.payload.output));
          if (typeof message.payload?.firstSeq === "number") { firstSeqRef.current = message.payload.firstSeq; setFirstSeq(message.payload.firstSeq); }
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
      };
      ws.onclose = () => { if (disposed || !pageVisibleRef.current) return; setConnected(false); attempts.current += 1; reconnect.current = window.setTimeout(connect, Math.min(8000, 500 * 2 ** Math.min(attempts.current, 4))); };
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
    return () => { disposed = true; document.removeEventListener("visibilitychange", onVisibilityChange); if (reconnect.current) window.clearTimeout(reconnect.current); observer.disconnect(); dataSubscription.dispose(); scrollSubscription.dispose(); socket.current?.close(); instance.dispose(); terminal.current = null; };
  }, [send, session.id]);

  useEffect(() => { rawRef.current = raw; ctrlRef.current = ctrl; }, [ctrl, raw]);
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!draft.trim()) return; send(`${draft}\r`); setDraft(""); };
  const sendControl = (key: string) => send(control(key));
  const loadEarlier = async () => {
    if (loadingEarlier || firstSeqRef.current <= 1) return;
    setLoadingEarlier(true);
    try {
      const result = await api<{ items: TerminalHistoryItem[] }>(`/api/terminal-sessions/${session.id}/history?beforeSeq=${firstSeqRef.current}&limit=2000`);
      const older = result.items.filter((item) => item.kind === "output").map((item) => item.data).join("");
      if (!older) { firstSeqRef.current = 1; setFirstSeq(1); return; }
      outputRef.current = `${older}${outputRef.current}`.slice(-4 * 1024 * 1024);
      firstSeqRef.current = result.items[0]?.seq ?? 1;
      setFirstSeq(firstSeqRef.current);
      const current = terminal.current;
      if (current) { current.reset(); current.write(outputRef.current); current.scrollToBottom(); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "加载更早输出失败"); }
    finally { setLoadingEarlier(false); }
  };
  return <div className="flex min-h-0 flex-1 flex-col bg-[#090d14] text-slate-100">
    <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-white/10 bg-slate-950 px-3 text-[11px] text-slate-300">
      <span className={`size-2 rounded-full ${connected ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`} />
      <span>{connected ? `已连接 · PID ${session.pid ?? "—"}` : "正在恢复连接，终端仍在后台运行"}</span>
      <span className="ml-auto hidden max-w-[45%] truncate font-mono text-slate-500 sm:block">{session.cwd}</span>
    </div>
    <div className="relative min-h-0 flex-1 overflow-hidden p-2 sm:p-3"><div ref={host} className="h-full" />{!atBottom && <button type="button" className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-lg border border-white/15 bg-slate-900/90 text-slate-100 shadow-lg" aria-label="回到底部" onClick={() => { terminal.current?.scrollToBottom(); setAtBottom(true); }}><ArrowDown className="size-4" /></button>}{firstSeq > 1 && <button type="button" className="absolute left-3 top-3 rounded-lg border border-white/15 bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-200" onClick={() => void loadEarlier()} disabled={loadingEarlier}>{loadingEarlier ? "加载中" : "加载更早输出"}</button>}</div>
    <div className="shrink-0 border-t border-white/10 bg-slate-950 px-2 py-2 pb-[max(.5rem,env(safe-area-inset-bottom))]">
      <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] touch-pan-x [&::-webkit-scrollbar]:hidden">
        <button type="button" className={`h-9 shrink-0 rounded-lg border px-3 text-xs ${raw ? "border-sky-400 bg-sky-400/15" : "border-white/15 bg-white/5"}`} onClick={() => setRaw((value) => !value)}><Keyboard className="mr-1 inline size-3.5" />{raw ? "直通键盘" : "命令行"}</button>
        <button type="button" className={`h-9 shrink-0 rounded-lg border px-3 text-xs ${ctrl ? "border-sky-400 bg-sky-400/15" : "border-white/15 bg-white/5"}`} onClick={() => setCtrl((value) => !value)}>Ctrl</button>
        {(["C", "D", "L", "Z"] as const).map((key) => <button key={key} type="button" className="h-9 shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 text-xs" onClick={() => sendControl(key)}>^{key}</button>)}
        <button type="button" className="h-9 shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 text-xs" onClick={() => send("\x1b")}>Esc</button>
      </div>
      {!raw && <form className="mt-1.5 flex gap-1.5" onSubmit={submit}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="输入命令，Enter 发送" inputMode="text" enterKeyHint="send" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="h-10 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 text-base text-slate-100 outline-none focus:border-sky-400" /><Button type="submit" size="sm" className="h-10 shrink-0">发送</Button></form>}
    </div>
  </div>;
}

export function TerminalChatPanel({ project, sessionId = "", onOpenSession }: { project: Project; sessionId?: string; onOpenSession?: (sessionId: string) => void }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(sessionId);
  const sessions = useQuery({ queryKey: ["terminal-chat-sessions", project.id], queryFn: () => api<SessionList>(`/api/projects/${project.id}/terminal-sessions`), refetchInterval: 5000 });
  const profiles = useQuery({ queryKey: ["terminal-profiles"], queryFn: () => api<{ profiles: Profile[] }>("/api/terminal-profiles") });
  const create = useMutation({ mutationFn: (profileId: string) => api<{ session: Session; terminal: TerminalChatSession }>(`/api/projects/${project.id}/terminal-sessions`, { method: "POST", body: JSON.stringify({ profileId, restartPolicy: "manual" }) }), onSuccess: (result) => { queryClient.setQueryData<SessionList>(["terminal-chat-sessions", project.id], (current) => ({ items: [result.terminal, ...(current?.items ?? [])] })); void queryClient.invalidateQueries({ queryKey: ["sessions", project.id] }); setSelectedId(result.terminal.id); onOpenSession?.(result.session.id); }, onError: (error) => toast.error(error instanceof Error ? error.message : "创建终端对话失败") });
  const restart = useMutation({ mutationFn: (id: string) => api<{ terminal: TerminalChatSession }>(`/api/terminal-sessions/${id}/restart`, { method: "POST" }), onSuccess: (result) => { update(result.terminal.id, result.terminal); toast.success("终端已重启"); }, onError: (error) => toast.error(error instanceof Error ? error.message : "重启终端失败") });
  const stop = useMutation({ mutationFn: (id: string) => api<{ terminal: TerminalChatSession }>(`/api/terminal-sessions/${id}/stop`, { method: "POST" }), onSuccess: (result) => { update(result.terminal.id, result.terminal); toast.success("终端已停止"); }, onError: (error) => toast.error(error instanceof Error ? error.message : "停止终端失败") });
  const items = sessions.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const update = useCallback((id: string, next: Partial<TerminalChatSession>) => queryClient.setQueryData<SessionList>(["terminal-chat-sessions", project.id], (current) => current ? { items: current.items.map((item) => item.id === id ? { ...item, ...next } : item) } : current), [project.id, queryClient]);
  const selectedChange = useCallback((next: Partial<TerminalChatSession>) => {
    if (selected) update(selected.id, next);
  }, [selected, update]);
  useEffect(() => {
    if (sessionId && items.some((item) => item.id === sessionId)) setSelectedId(sessionId);
    else if (!selectedId && items[0]) setSelectedId(items[0].id);
  }, [items, selectedId, sessionId]);
  return <section className="flex h-full min-h-0 flex-col bg-background">
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-3"><SquareTerminal className="size-4 shrink-0 text-primary" /><div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{items.map((item) => <button key={item.id} type="button" onClick={() => { setSelectedId(item.id); onOpenSession?.(item.sessionId); }} className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs ${selected?.id === item.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent"}`}><span className={`size-1.5 rounded-full ${item.state === "running" ? "bg-emerald-500" : item.state === "needs_attention" ? "bg-red-500" : "bg-muted-foreground"}`} />{item.title}</button>)}</div>
      <select aria-label="选择终端 profile" className="h-8 max-w-36 rounded-lg border border-border bg-background px-2 text-xs" value="" onChange={(event) => { if (event.target.value) { create.mutate(event.target.value); event.target.value = ""; } }} disabled={create.isPending}><option value="" disabled>新建终端</option>{(profiles.data?.profiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>
      <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="新建终端对话" onClick={() => create.mutate("shell")} disabled={create.isPending}>{create.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}</Button>
      <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="刷新终端对话" onClick={() => void sessions.refetch()}><RefreshCw className={`size-4 ${sessions.isFetching ? "animate-spin" : ""}`} /></Button>
    </div>
    {selected ? <><div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground"><span className="truncate">{selected.title} · {selected.profileId}</span><span className="ml-auto">{selected.state}</span><Button type="button" size="icon" variant="ghost" className="size-7" aria-label="重启终端对话" onClick={() => restart.mutate(selected.id)}><RotateCcw className="size-3.5" /></Button><Button type="button" size="icon" variant="ghost" className="size-7" aria-label="停止终端对话" onClick={() => stop.mutate(selected.id)}><Square className="size-3.5" /></Button></div><TerminalChatViewport key={selected.id} session={selected} onChange={selectedChange} /></> : <div className="grid min-h-0 flex-1 place-items-center px-6 text-center"><div><SquareTerminal className="mx-auto size-10 text-muted-foreground" /><p className="mt-3 text-sm font-medium">新建一个终端对话</p><p className="mt-1 text-xs text-muted-foreground">关闭页面不会停止服务端的 CLI 进程。</p><Button className="mt-4" size="sm" onClick={() => create.mutate("shell")}><Plus className="size-4" />新建终端对话</Button></div></div>}
  </section>;
}
