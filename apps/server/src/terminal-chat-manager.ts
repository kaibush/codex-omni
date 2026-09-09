import type { IPty } from "node-pty";
import * as pty from "node-pty";
import type { Store, TerminalSessionRow } from "@codex-omni/db";
import { buildTerminalEnv, resolveTerminalRuntime } from "./terminal-shell.js";

type WebSocket = { readyState: number; OPEN: number; send(data: string): void };
type Profile = { id: string; name: string; executable: string; args: string[] };
type Managed = { row: TerminalSessionRow; process: IPty | null; subscribers: Set<WebSocket>; timer: NodeJS.Timeout | null };

const PROFILES: Profile[] = [
  { id: "codex", name: "Codex", executable: "codex", args: [] },
  { id: "claude-code", name: "Claude Code", executable: "claude", args: [] },
  { id: "shell", name: "Shell", executable: "", args: [] }
];
const MAX_RESTARTS = 3;
const RESTART_WINDOW = 5 * 60_000;

export const terminalProfiles = () => PROFILES.map((profile) => ({ ...profile }));

export class TerminalChatManager {
  private readonly items = new Map<string, Managed>();
  constructor(private readonly store: Store) {}

  restore() {
    for (const row of this.store.listTerminalSessions()) {
      const item = { row, process: null, subscribers: new Set<WebSocket>(), timer: null };
      this.items.set(row.id, item);
      if (row.desiredState === "running") this.start(row.id, true);
    }
  }

  private publicRow(item: Managed) {
    return { ...item.row, pid: item.process?.pid ?? item.row.pid, subscriberCount: item.subscribers.size };
  }
  private send(socket: WebSocket, event: Record<string, unknown>) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  }
  private broadcast(item: Managed, event: Record<string, unknown>) {
    for (const socket of item.subscribers) this.send(socket, event);
  }
  private profile(id: string) {
    return PROFILES.find((profile) => profile.id === id);
  }

  create(input: { projectId: string; sessionId: string; title: string; cwd: string; profileId: string; restartPolicy?: "manual" | "on-unexpected-exit" }) {
    if (!this.profile(input.profileId)) throw new Error("不支持的终端 profile");
    const row = this.store.createTerminalSession(input);
    const item: Managed = { row, process: null, subscribers: new Set(), timer: null };
    this.items.set(row.id, item);
    this.start(row.id, false);
    return this.publicRow(item);
  }

  list(projectId?: string) {
    return (projectId ? [...this.items.values()].filter((item) => item.row.projectId === projectId) : [...this.items.values()]).map((item) => this.publicRow(item));
  }
  get(id: string) {
    const item = this.items.get(id);
    return item ? this.publicRow(item) : null;
  }
  private start(id: string, restoring: boolean) {
    const item = this.items.get(id);
    if (!item || item.process || item.row.desiredState !== "running") return;
    const profile = this.profile(item.row.profileId);
    if (!profile) return this.fail(item, "找不到终端 profile");
    const runtime = resolveTerminalRuntime();
    const executable = profile.executable || runtime.shell;
    const args = profile.executable ? profile.args : runtime.args;
    try {
      const child = pty.spawn(executable, args, {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: item.row.cwd,
        env: buildTerminalEnv({ shell: executable, terminalId: id, home: runtime.home, username: runtime.username })
      });
      item.process = child;
      item.row = this.store.updateTerminalSession(id, { state: "running", pid: child.pid, lastError: null, nextRestartAt: null })!;
      this.broadcast(item, { type: "terminal.state", terminalId: id, payload: { state: "running", pid: child.pid, restoring } });
      child.onData((data) => this.output(item, data));
      child.onExit(({ exitCode, signal }) => this.exited(item, exitCode, signal ?? null));
    } catch (error) {
      this.fail(item, error instanceof Error ? error.message : String(error));
    }
  }
  private output(item: Managed, data: string) {
    if (!data) return;
    const seq = item.row.lastSeq + 1;
    item.row = this.store.updateTerminalSession(item.row.id, { lastSeq: seq, lastOutputAt: Date.now() })!;
    this.store.addTerminalEvent({ terminalId: item.row.id, seq, kind: "output", data });
    this.broadcast(item, { type: "terminal.output", terminalId: item.row.id, seq, payload: { data } });
  }
  private exited(item: Managed, exitCode: number, signal: number | null) {
    item.process = null;
    const now = Date.now();
    item.row = this.store.updateTerminalSession(item.row.id, { state: "exited", pid: null, lastExitCode: exitCode, lastSignal: signal, lastError: null })!;
    this.broadcast(item, { type: "terminal.exit", terminalId: item.row.id, seq: item.row.lastSeq, payload: { exitCode, signal } });
    if (item.row.desiredState === "running" && item.row.restartPolicy === "on-unexpected-exit" && exitCode !== 0) {
      const withinWindow = item.row.restartWindowStartedAt && now - item.row.restartWindowStartedAt < RESTART_WINDOW;
      const count = withinWindow ? item.row.restartCount : 0;
      if (count >= MAX_RESTARTS) {
        item.row = this.store.updateTerminalSession(item.row.id, { state: "needs_attention", nextRestartAt: null })!;
        this.broadcast(item, { type: "terminal.state", terminalId: item.row.id, payload: { state: "needs_attention", reason: "restart-circuit-open" } });
        return;
      }
      const delay = [1000, 2000, 5000, 15000][count] ?? 15000;
      item.row = this.store.updateTerminalSession(item.row.id, { state: "provisioning", restartCount: count + 1, restartWindowStartedAt: withinWindow ? item.row.restartWindowStartedAt : now, nextRestartAt: now + delay })!;
      item.timer = setTimeout(() => { item.timer = null; this.start(item.row.id, false); }, delay);
    }
  }
  private fail(item: Managed, message: string) {
    item.process = null;
    item.row = this.store.updateTerminalSession(item.row.id, { state: "failed", pid: null, lastError: message })!;
    this.broadcast(item, { type: "terminal.state", terminalId: item.row.id, payload: { state: "failed", reason: message } });
  }
  input(id: string, data: string) {
    const item = this.items.get(id);
    if (!item?.process || item.row.state !== "running") return false;
    item.process.write(data);
    return true;
  }
  resize(id: string, cols: number, rows: number) {
    const item = this.items.get(id);
    if (!item?.process) return false;
    item.process.resize(Math.max(20, Math.min(400, Math.trunc(cols))), Math.max(5, Math.min(200, Math.trunc(rows))));
    return true;
  }
  restart(id: string) {
    const item = this.items.get(id);
    if (!item) return false;
    if (item.timer) clearTimeout(item.timer);
    item.timer = null;
    item.row = this.store.updateTerminalSession(id, { desiredState: "running", state: "provisioning", restartCount: 0, restartWindowStartedAt: null, nextRestartAt: null })!;
    if (item.process) { try { item.process.kill("SIGTERM"); } catch { /* exited */ } }
    item.process = null;
    this.start(id, false);
    return true;
  }
  stop(id: string) {
    const item = this.items.get(id);
    if (!item) return false;
    if (item.timer) clearTimeout(item.timer);
    item.timer = null;
    item.row = this.store.updateTerminalSession(id, { desiredState: "stopped", state: "stopped", nextRestartAt: null, stoppedAt: Date.now() })!;
    if (item.process) { try { item.process.kill("SIGINT"); } catch { /* exited */ } }
    item.process = null;
    this.broadcast(item, { type: "terminal.state", terminalId: id, payload: { state: "stopped" } });
    return true;
  }
  subscribe(id: string, socket: WebSocket, lastSeq = 0) {
    const item = this.items.get(id);
    if (!item) throw new Error("Terminal session not found");
    item.subscribers.add(socket);
    const events = this.store.listTerminalEvents(id, lastSeq);
    this.send(socket, { type: "terminal.snapshot", terminalId: id, seq: item.row.lastSeq, payload: { terminal: this.publicRow(item), output: events.filter((event) => event.kind === "output").map((event) => event.data).join(""), replay: lastSeq > 0 } });
  }
  unsubscribeSocket(socket: WebSocket) { for (const item of this.items.values()) item.subscribers.delete(socket); }
  shutdown() {
    for (const item of this.items.values()) {
      if (item.timer) clearTimeout(item.timer);
      if (item.process) { try { item.process.kill("SIGHUP"); } catch { /* exited */ } }
      item.process = null;
    }
  }
}
