import type { IPty } from "node-pty";
import * as pty from "node-pty";
import type { Store, TerminalSessionRow } from "@codex-omni/db";
import { buildTerminalEnv, resolveTerminalRuntime } from "./terminal-shell.js";

type WebSocket = { readyState: number; OPEN: number; send(data: string): void };
type Profile = { id: string; name: string; executable: string; args: string[] };
type Managed = { row: TerminalSessionRow; process: IPty | null; subscribers: Set<WebSocket>; timer: NodeJS.Timeout | null; generation: number };
type TerminalPatch = Parameters<Store["updateTerminalSession"]>[1];

const PROFILES: Profile[] = [
  { id: "codex", name: "Codex", executable: "codex", args: [] },
  { id: "claude-code", name: "Claude Code", executable: "claude", args: [] },
  { id: "shell", name: "Shell", executable: "", args: [] }
];
const MAX_RESTARTS = 3;
const RESTART_WINDOW = 5 * 60_000;

export const terminalProfiles = () => PROFILES.map((profile) => ({ ...profile }));

export function terminalSnapshotFromEvents(
  events: Array<{ seq: number; kind: string; data: string }>,
  lastSeq: number,
  currentLastSeq: number
) {
  let restartIndex = -1;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    if (event.kind === "marker" && event.data.includes("已重启")) restartIndex = i;
  }
  const restarted = restartIndex >= 0;
  const visible = restarted ? events.slice(restartIndex + 1) : events;
  const firstSeq = events[0]?.seq ?? currentLastSeq + 1;
  const complete = lastSeq === 0 ? firstSeq <= 1 : firstSeq <= lastSeq + 1;
  return {
    output: visible.filter((event) => event.kind === "output").map((event) => event.data).join(""),
    firstSeq: restarted ? 1 : firstSeq,
    replay: lastSeq > 0 && complete && !restarted,
    truncated: restarted ? false : !complete
  };
}

export class TerminalChatManager {
  private readonly items = new Map<string, Managed>();
  private shuttingDown = false;
  constructor(private readonly store: Store) {}

  restore() {
    for (const row of this.store.listTerminalSessions()) {
      const item = { row, process: null, subscribers: new Set<WebSocket>(), timer: null, generation: 0 };
      this.items.set(row.id, item);
      if (row.desiredState === "running" && row.lastSeq > 0) this.marker(item, "Server 已重启，正在恢复终端进程");
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
  private persist(item: Managed, patch: TerminalPatch) {
    const next = this.store.updateTerminalSession(item.row.id, patch);
    if (!next) {
      this.dispose(item.row.id);
      return false;
    }
    item.row = next;
    return true;
  }
  private dispose(id: string, signal: NodeJS.Signals = "SIGTERM") {
    const item = this.items.get(id);
    if (!item) return false;
    if (item.timer) clearTimeout(item.timer);
    item.timer = null;
    item.generation += 1;
    if (item.process) {
      try { item.process.kill(signal); } catch { /* already gone */ }
      item.process = null;
    }
    this.items.delete(id);
    return true;
  }

  create(input: { projectId: string; sessionId: string; title: string; cwd: string; profileId: string; restartPolicy?: "manual" | "on-unexpected-exit" }) {
    if (!this.profile(input.profileId)) throw new Error("不支持的终端 profile");
    const running = [...this.items.values()].filter((item) => item.row?.projectId === input.projectId && item.row?.desiredState === "running").length;
    if (running >= 12) throw new Error("每个工程最多同时运行 12 个终端对话");
    const row = this.store.createTerminalSession(input);
    const item: Managed = { row, process: null, subscribers: new Set(), timer: null, generation: 0 };
    this.items.set(row.id, item);
    this.start(row.id, false);
    return this.publicRow(item);
  }

  list(projectId?: string) {
    return [...this.items.values()]
      .filter((item) => item.row && (!projectId || item.row.projectId === projectId))
      .map((item) => this.publicRow(item));
  }
  get(id: string) {
    const item = this.items.get(id);
    return item?.row ? this.publicRow(item) : null;
  }
  rename(id: string, title: string) {
    return this.configure(id, { title });
  }
  configure(id: string, patch: { title?: string; restartPolicy?: "manual" | "on-unexpected-exit" }) {
    const item = this.items.get(id);
    if (!item?.row) return null;
    const next: TerminalPatch = {};
    if (patch.title !== undefined) next.title = patch.title.trim().slice(0, 120) || item.row.title;
    if (patch.restartPolicy) next.restartPolicy = patch.restartPolicy;
    if (!Object.keys(next).length) return this.publicRow(item);
    if (!this.persist(item, next)) return null;
    if (next.title && this.store.getSession(item.row.sessionId)) {
      this.store.updateSession(item.row.sessionId, { title: item.row.title });
    }
    this.broadcast(item, { type: "terminal.state", terminalId: id, payload: next });
    return this.publicRow(item);
  }
  private start(id: string, restoring: boolean) {
    const item = this.items.get(id);
    if (this.shuttingDown || !item?.row || item.process || item.row.desiredState !== "running") return;
    const profile = this.profile(item.row.profileId);
    if (!profile) return this.fail(item, "找不到终端 profile");
    const runtime = resolveTerminalRuntime();
    const executable = profile.executable || runtime.shell;
    const args = profile.executable ? profile.args : runtime.args;
    const generation = ++item.generation;
    try {
      const child = pty.spawn(executable, args, {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: item.row.cwd,
        env: buildTerminalEnv({ shell: executable, terminalId: id, home: runtime.home, username: runtime.username })
      });
      item.process = child;
      if (!this.persist(item, { state: "running", pid: child.pid, lastError: null, nextRestartAt: null })) {
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
        return;
      }
      this.updateSessionStatus(item, "running");
      this.broadcast(item, { type: "terminal.state", terminalId: id, payload: { state: "running", pid: child.pid, restoring } });
      child.onData((data) => { if (item.generation === generation) this.output(item, data); });
      child.onExit(({ exitCode, signal }) => { if (item.generation === generation) this.exited(item, exitCode, signal ?? null); });
    } catch (error) {
      this.fail(item, error instanceof Error ? error.message : String(error));
    }
  }
  private updateSessionStatus(item: Managed, status: "idle" | "running" | "failed") {
    if (!item.row || !this.store.getSession(item.row.sessionId)) return;
    this.store.updateSession(item.row.sessionId, { status });
  }
  private output(item: Managed, data: string) {
    if (!data || !item.row || !this.items.has(item.row.id)) return;
    const seq = item.row.lastSeq + 1;
    if (!this.persist(item, { lastSeq: seq, lastOutputAt: Date.now() })) return;
    this.store.addTerminalEvent({ terminalId: item.row.id, seq, kind: "output", data });
    if (seq % 100 === 0) this.store.pruneTerminalEvents(item.row.id);
    this.broadcast(item, { type: "terminal.output", terminalId: item.row.id, seq, payload: { data } });
  }
  private marker(item: Managed, text: string) {
    if (!item.row) return;
    const seq = item.row.lastSeq + 1;
    if (!this.persist(item, { lastSeq: seq, lastOutputAt: Date.now() })) return;
    this.store.addTerminalEvent({ terminalId: item.row.id, seq, kind: "marker", data: text });
    this.broadcast(item, { type: "terminal.marker", terminalId: item.row.id, seq, payload: { text } });
  }
  private exited(item: Managed, exitCode: number, signal: number | null) {
    item.process = null;
    if (!item.row || !this.items.has(item.row.id)) return;
    const now = Date.now();
    if (!this.persist(item, { state: "exited", pid: null, lastExitCode: exitCode, lastSignal: signal, lastError: null })) return;
    this.updateSessionStatus(item, exitCode === 0 ? "idle" : "failed");
    this.broadcast(item, { type: "terminal.exit", terminalId: item.row.id, seq: item.row.lastSeq, payload: { exitCode, signal } });
    if (item.row.desiredState === "running" && item.row.restartPolicy === "on-unexpected-exit" && exitCode !== 0) {
      const withinWindow = item.row.restartWindowStartedAt && now - item.row.restartWindowStartedAt < RESTART_WINDOW;
      const count = withinWindow ? item.row.restartCount : 0;
      if (count >= MAX_RESTARTS) {
        if (!this.persist(item, { state: "needs_attention", nextRestartAt: null })) return;
        this.updateSessionStatus(item, "failed");
        this.broadcast(item, { type: "terminal.state", terminalId: item.row.id, payload: { state: "needs_attention", reason: "restart-circuit-open" } });
        return;
      }
      const delay = [1000, 2000, 5000, 15000][count] ?? 15000;
      if (!this.persist(item, { state: "provisioning", restartCount: count + 1, restartWindowStartedAt: withinWindow ? item.row.restartWindowStartedAt : now, nextRestartAt: now + delay })) return;
      this.updateSessionStatus(item, "running");
      const terminalId = item.row.id;
      item.timer = setTimeout(() => { item.timer = null; this.start(terminalId, false); }, delay);
    }
  }
  private fail(item: Managed, message: string) {
    item.process = null;
    if (!item.row || !this.items.has(item.row.id)) return;
    if (!this.persist(item, { state: "failed", pid: null, lastError: message })) return;
    this.updateSessionStatus(item, "failed");
    this.broadcast(item, { type: "terminal.state", terminalId: item.row.id, payload: { state: "failed", reason: message } });
  }
  input(id: string, data: string) {
    const item = this.items.get(id);
    if (!item?.process || !item.row || item.row.state !== "running") return false;
    item.process.write(data);
    const seq = item.row.lastSeq + 1;
    if (!this.persist(item, { lastSeq: seq, lastOutputAt: Date.now() })) return false;
    this.store.addTerminalEvent({ terminalId: id, seq, kind: "input", data });
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
    if (!item?.row) return false;
    if (item.timer) clearTimeout(item.timer);
    item.timer = null;
    item.generation += 1;
    if (!this.persist(item, { desiredState: "running", state: "provisioning", restartCount: 0, restartWindowStartedAt: null, nextRestartAt: null })) return false;
    if (item.process) { try { item.process.kill("SIGTERM"); } catch { /* exited */ } }
    item.process = null;
    this.marker(item, "终端已重启");
    this.start(id, false);
    return true;
  }
  stop(id: string) {
    const item = this.items.get(id);
    if (!item?.row) return false;
    if (item.timer) clearTimeout(item.timer);
    item.timer = null;
    item.generation += 1;
    if (!this.persist(item, { desiredState: "stopped", state: "stopped", nextRestartAt: null, stoppedAt: Date.now() })) return true;
    this.updateSessionStatus(item, "idle");
    if (item.process) { try { item.process.kill("SIGINT"); } catch { /* exited */ } }
    item.process = null;
    this.broadcast(item, { type: "terminal.state", terminalId: id, payload: { state: "stopped" } });
    return true;
  }
  remove(id: string) {
    return this.dispose(id, "SIGINT");
  }
  subscribe(id: string, socket: WebSocket, lastSeq = 0) {
    const item = this.items.get(id);
    if (!item?.row) throw new Error("Terminal session not found");
    item.subscribers.add(socket);
    const limit = 5000;
    const events = lastSeq > 0
      ? this.store.listTerminalEvents(id, lastSeq, limit)
      : this.store.listTerminalEventsBefore(id, item.row.lastSeq + 1, limit);
    const snapshot = terminalSnapshotFromEvents(events, lastSeq, item.row.lastSeq);
    this.send(socket, { type: "terminal.snapshot", terminalId: id, seq: item.row.lastSeq, payload: { terminal: this.publicRow(item), ...snapshot } });
  }
  closeProject(projectId: string) {
    for (const item of [...this.items.values()]) if (item.row?.projectId === projectId) this.remove(item.row.id);
  }
  unsubscribeSocket(socket: WebSocket) { for (const item of this.items.values()) item.subscribers.delete(socket); }
  shutdown() {
    this.shuttingDown = true;
    for (const item of this.items.values()) {
      if (item.timer) clearTimeout(item.timer);
      item.generation += 1;
      if (item.process) { try { item.process.kill("SIGHUP"); } catch { /* exited */ } }
      item.process = null;
    }
  }
}
