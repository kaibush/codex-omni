import os from "node:os";
import type { IPty } from "node-pty";
import * as pty from "node-pty";
import { nanoid } from "nanoid";

type WebSocket = { readyState: number; OPEN: number; send(data: string): void };

type TerminalChunk = {
  seq: number;
  data: string;
};

type ManagedTerminal = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  cwd: string;
  shell: string;
  process: IPty;
  pid: number | null;
  status: "running" | "exited";
  cols: number;
  rows: number;
  seq: number;
  chunks: TerminalChunk[];
  bufferedCharacters: number;
  createdAt: number;
  updatedAt: number;
  exitedAt: number | null;
  exitCode: number | null;
  signal: number | null;
};

const MAX_BUFFERED_CHARACTERS = 1_000_000;
const MAX_TERMINALS_PER_PROJECT = 12;

export type PublicTerminal = Omit<ManagedTerminal, "process" | "chunks" | "bufferedCharacters"> & {
  subscriberCount: number;
};

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private subscribers = new Map<string, Set<WebSocket>>();

  private publicTerminal(terminal: ManagedTerminal): PublicTerminal {
    return {
      id: terminal.id,
      projectId: terminal.projectId,
      projectName: terminal.projectName,
      name: terminal.name,
      cwd: terminal.cwd,
      shell: terminal.shell,
      pid: terminal.pid,
      status: terminal.status,
      cols: terminal.cols,
      rows: terminal.rows,
      seq: terminal.seq,
      createdAt: terminal.createdAt,
      updatedAt: terminal.updatedAt,
      exitedAt: terminal.exitedAt,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      subscriberCount: this.subscribers.get(terminal.id)?.size ?? 0
    };
  }

  private send(socket: WebSocket, event: Record<string, unknown>) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  }

  private broadcast(terminalId: string, event: Record<string, unknown>) {
    for (const socket of this.subscribers.get(terminalId) ?? []) this.send(socket, event);
  }

  private appendOutput(terminal: ManagedTerminal, data: string) {
    if (!data) return;
    terminal.seq += 1;
    terminal.updatedAt = Date.now();
    const chunk = { seq: terminal.seq, data };
    terminal.chunks.push(chunk);
    terminal.bufferedCharacters += data.length;
    while (terminal.bufferedCharacters > MAX_BUFFERED_CHARACTERS && terminal.chunks.length > 1) {
      const removed = terminal.chunks.shift();
      if (removed) terminal.bufferedCharacters -= removed.data.length;
    }
    this.broadcast(terminal.id, {
      type: "terminal.output",
      terminalId: terminal.id,
      seq: chunk.seq,
      payload: { data }
    });
  }

  create(input: {
    projectId: string;
    projectName: string;
    cwd: string;
    name?: string;
    cols?: number;
    rows?: number;
  }) {
    const existing = this.list(input.projectId);
    if (
      existing.filter((terminal) => terminal.status === "running").length >=
      MAX_TERMINALS_PER_PROJECT
    )
      throw new Error(`每个工程最多同时运行 ${MAX_TERMINALS_PER_PROJECT} 个终端`);
    const id = nanoid();
    const cols = Math.max(20, Math.min(400, Math.trunc(input.cols ?? 120)));
    const rows = Math.max(5, Math.min(200, Math.trunc(input.rows ?? 30)));
    const shell =
      process.env.SHELL?.trim() || (process.platform === "win32" ? "powershell.exe" : "/bin/sh");
    const child = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: input.cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        CODEX_OMNI_TERMINAL_ID: id
      } as Record<string, string>
    });
    const now = Date.now();
    const terminal: ManagedTerminal = {
      id,
      projectId: input.projectId,
      projectName: input.projectName,
      name: input.name?.trim() || `终端 ${existing.length + 1}`,
      cwd: input.cwd,
      shell,
      process: child,
      pid: child.pid ?? null,
      status: "running",
      cols,
      rows,
      seq: 0,
      chunks: [],
      bufferedCharacters: 0,
      createdAt: now,
      updatedAt: now,
      exitedAt: null,
      exitCode: null,
      signal: null
    };
    this.terminals.set(id, terminal);
    child.onData((data) => this.appendOutput(terminal, data));
    child.onExit(({ exitCode, signal }) => {
      terminal.status = "exited";
      terminal.exitCode = exitCode;
      terminal.signal = signal ?? null;
      terminal.exitedAt = Date.now();
      terminal.updatedAt = terminal.exitedAt;
      this.broadcast(id, {
        type: "terminal.exit",
        terminalId: id,
        seq: terminal.seq,
        payload: { exitCode, signal, exitedAt: terminal.exitedAt }
      });
    });
    return this.publicTerminal(terminal);
  }

  list(projectId?: string) {
    return [...this.terminals.values()]
      .filter((terminal) => !projectId || terminal.projectId === projectId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((terminal) => this.publicTerminal(terminal));
  }

  get(id: string) {
    const terminal = this.terminals.get(id);
    return terminal ? this.publicTerminal(terminal) : null;
  }

  rename(id: string, name: string) {
    const terminal = this.terminals.get(id);
    if (!terminal) return null;
    terminal.name = name.trim().slice(0, 80) || terminal.name;
    terminal.updatedAt = Date.now();
    this.broadcast(id, {
      type: "terminal.updated",
      terminalId: id,
      seq: terminal.seq,
      payload: { terminal: this.publicTerminal(terminal) }
    });
    return this.publicTerminal(terminal);
  }

  input(id: string, data: string) {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.status !== "running") return false;
    terminal.process.write(data);
    terminal.updatedAt = Date.now();
    return true;
  }

  resize(id: string, cols: number, rows: number) {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.status !== "running") return false;
    terminal.cols = Math.max(20, Math.min(400, Math.trunc(cols)));
    terminal.rows = Math.max(5, Math.min(200, Math.trunc(rows)));
    terminal.process.resize(terminal.cols, terminal.rows);
    terminal.updatedAt = Date.now();
    return true;
  }

  subscribe(id: string, socket: WebSocket, lastSeq?: number) {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error("Terminal not found");
    const set = this.subscribers.get(id) ?? new Set<WebSocket>();
    set.add(socket);
    this.subscribers.set(id, set);
    const firstSeq = terminal.chunks[0]?.seq ?? terminal.seq + 1;
    const replayFrom = typeof lastSeq === "number" ? Math.max(0, Math.trunc(lastSeq)) : 0;
    const canReplay = replayFrom >= firstSeq - 1 && replayFrom <= terminal.seq;
    this.send(socket, {
      type: "terminal.snapshot",
      terminalId: id,
      seq: canReplay ? replayFrom : terminal.seq,
      payload: {
        terminal: this.publicTerminal(terminal),
        output: canReplay ? "" : terminal.chunks.map((chunk) => chunk.data).join(""),
        replay: canReplay
      }
    });
    if (canReplay) {
      for (const chunk of terminal.chunks) {
        if (chunk.seq <= replayFrom) continue;
        this.send(socket, {
          type: "terminal.output",
          terminalId: id,
          seq: chunk.seq,
          payload: { data: chunk.data }
        });
      }
    }
  }

  unsubscribeSocket(socket: WebSocket) {
    for (const [terminalId, set] of this.subscribers) {
      set.delete(socket);
      if (!set.size) this.subscribers.delete(terminalId);
    }
  }

  close(id: string) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    if (terminal.status === "running") {
      try {
        terminal.process.kill("SIGHUP");
      } catch {
        terminal.process.kill();
      }
    }
    this.terminals.delete(id);
    this.broadcast(id, { type: "terminal.closed", terminalId: id, payload: {} });
    this.subscribers.delete(id);
    return true;
  }

  closeProject(projectId: string) {
    for (const terminal of [...this.terminals.values()]) {
      if (terminal.projectId === projectId) this.close(terminal.id);
    }
  }

  shutdown() {
    for (const terminal of this.terminals.values()) {
      if (terminal.status !== "running") continue;
      try {
        terminal.process.kill("SIGHUP");
      } catch {
        terminal.process.kill();
      }
    }
    this.terminals.clear();
    this.subscribers.clear();
  }
}

export const terminalHostLabel = () => os.hostname();
