import { beforeEach, describe, expect, it, vi } from "vitest";

const ptyMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    pid: number;
    writes: string[];
    kills: Array<string | undefined>;
    emitData(data: string): void;
    emitExit(exitCode: number, signal?: number): void;
  }>
}));

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => {
    const dataHandlers: Array<(data: string) => void> = [];
    const exitHandlers: Array<(event: { exitCode: number; signal?: number }) => void> = [];
    const instance = {
      pid: 4000 + ptyMocks.instances.length,
      writes: [] as string[],
      kills: [] as Array<string | undefined>,
      write(data: string) { this.writes.push(data); },
      resize() {},
      kill(signal?: string) { this.kills.push(signal); },
      onData(handler: (data: string) => void) { dataHandlers.push(handler); return { dispose() {} }; },
      onExit(handler: (event: { exitCode: number; signal?: number }) => void) { exitHandlers.push(handler); return { dispose() {} }; },
      emitData(data: string) { for (const handler of dataHandlers) handler(data); },
      emitExit(exitCode: number, signal?: number) { for (const handler of exitHandlers) handler({ exitCode, ...(signal === undefined ? {} : { signal }) }); }
    };
    ptyMocks.instances.push(instance);
    return instance;
  })
}));

import { Store, type TerminalSessionRow } from "@codex-omni/db";
import { TerminalChatManager } from "./terminal-chat-manager.js";

const row = (overrides: Partial<TerminalSessionRow> = {}): TerminalSessionRow => ({
  id: "terminal-1", sessionId: "session-1", projectId: "project-1", profileId: "shell", title: "Shell", cwd: "/tmp", desiredState: "running", state: "provisioning", restartPolicy: "manual", pid: null, lastSeq: 0, lastOutputAt: null, lastExitCode: null, lastSignal: null, restartCount: 0, restartWindowStartedAt: null, nextRestartAt: null, lastError: null, createdAt: 1, updatedAt: 1, stoppedAt: null, ...overrides
});

function makeStore() {
  const rows = new Map<string, TerminalSessionRow>();
  const sessions = new Set<string>(["session-1"]);
  const events: Array<{ terminalId: string; seq: number; kind: string; data: string }> = [];
  let nextId = 1;
  return {
    store: {
      listTerminalSessions: () => [...rows.values()],
      createTerminalSession: (input: { projectId: string; sessionId: string; title: string; cwd: string; profileId: string }) => {
        const created = row({ id: `terminal-${nextId++}`, ...input, state: "provisioning" });
        rows.set(created.id, created);
        sessions.add(created.sessionId);
        return created;
      },
      updateTerminalSession: (id: string, input: Partial<TerminalSessionRow>) => {
        const current = rows.get(id);
        if (!current) return undefined;
        const next = { ...current, ...input };
        rows.set(id, next);
        return next;
      },
      getSession: (id: string) => sessions.has(id) ? { id } : undefined,
      updateSession: vi.fn(),
      addTerminalEvent: (event: typeof events[number]) => events.push(event),
      listTerminalEvents: (_id: string, after: number) => events.filter((event) => event.seq > after),
      listTerminalEventsBefore: (_id: string, before: number) => events.filter((event) => event.seq < before),
      pruneTerminalEvents: vi.fn(),
      deleteRow: (id: string) => { rows.delete(id); }
    } as unknown as Store,
    events,
    deleteRow: (id: string) => { rows.delete(id); },
    deleteSession: (id: string) => {
      sessions.delete(id);
      for (const [terminalId, current] of [...rows]) if (current.sessionId === id) rows.delete(terminalId);
    }
  };
}

beforeEach(() => { ptyMocks.instances.length = 0; vi.clearAllMocks(); });

describe("TerminalChatManager", () => {
  it("persists output and replays it to a reconnecting subscriber", () => {
    const { store } = makeStore();
    const manager = new TerminalChatManager(store);
    const terminal = manager.create({ projectId: "project-1", sessionId: "session-1", title: "Shell", cwd: "/tmp", profileId: "shell" });
    const events: Array<Record<string, any>> = [];
    const socket = { readyState: 1, OPEN: 1, send(data: string) { events.push(JSON.parse(data)); } };
    manager.subscribe(terminal.id, socket);
    ptyMocks.instances[0]!.emitData("hello\r\n");
    expect(events.at(-1)).toMatchObject({ type: "terminal.output", seq: 1, payload: { data: "hello\r\n" } });
    manager.unsubscribeSocket(socket);
    const replay: Array<Record<string, any>> = [];
    manager.subscribe(terminal.id, { readyState: 1, OPEN: 1, send(data: string) { replay.push(JSON.parse(data)); } }, 0);
    expect(replay[0]).toMatchObject({ type: "terminal.snapshot", payload: { output: "hello\r\n", replay: false } });
  });

  it("does not let an old exit callback overwrite a manually restarted terminal", () => {
    const { store } = makeStore();
    const manager = new TerminalChatManager(store);
    const terminal = manager.create({ projectId: "project-1", sessionId: "session-1", title: "Shell", cwd: "/tmp", profileId: "shell" });
    const first = ptyMocks.instances[0]!;
    manager.restart(terminal.id);
    const second = ptyMocks.instances[1]!;
    first.emitExit(1, 9);
    expect(manager.get(terminal.id)?.pid).toBe(second.pid);
    expect(manager.get(terminal.id)?.state).toBe("running");
  });

  it("stops without scheduling an automatic restart", () => {
    const { store } = makeStore();
    const manager = new TerminalChatManager(store);
    const terminal = manager.create({ projectId: "project-1", sessionId: "session-1", title: "Shell", cwd: "/tmp", profileId: "shell", restartPolicy: "on-unexpected-exit" });
    manager.stop(terminal.id);
    ptyMocks.instances[0]!.emitExit(1, 2);
    expect(manager.get(terminal.id)).toMatchObject({ state: "stopped", desiredState: "stopped" });
  });

  it("updates restart policy without spawning another process", () => {
    const { store } = makeStore();
    const manager = new TerminalChatManager(store);
    const terminal = manager.create({ projectId: "project-1", sessionId: "session-1", title: "Shell", cwd: "/tmp", profileId: "shell" });
    expect(manager.configure(terminal.id, { restartPolicy: "on-unexpected-exit" })).toMatchObject({
      id: terminal.id,
      restartPolicy: "on-unexpected-exit"
    });
    expect(ptyMocks.instances).toHaveLength(1);
  });

  it("can create another terminal after the previous session is removed", () => {
    const { store, deleteSession } = makeStore();
    const manager = new TerminalChatManager(store);
    const first = manager.create({ projectId: "project-1", sessionId: "session-1", title: "Shell", cwd: "/tmp", profileId: "shell" });
    manager.remove(first.id);
    deleteSession("session-1");
    ptyMocks.instances[0]!.emitExit(0);
    const second = manager.create({ projectId: "project-1", sessionId: "session-2", title: "New shell", cwd: "/tmp", profileId: "shell" });
    expect(second.sessionId).toBe("session-2");
    expect(manager.list("project-1")).toHaveLength(1);
    expect(manager.get(first.id)).toBeNull();
  });

  it("drops cascaded terminals instead of crashing on the next create", () => {
    const { store, deleteRow } = makeStore();
    const manager = new TerminalChatManager(store);
    const first = manager.create({ projectId: "project-1", sessionId: "session-1", title: "Shell", cwd: "/tmp", profileId: "shell" });
    deleteRow(first.id);
    ptyMocks.instances[0]!.emitExit(1);
    expect(manager.get(first.id)).toBeNull();
    const second = manager.create({ projectId: "project-1", sessionId: "session-2", title: "New shell", cwd: "/tmp", profileId: "shell" });
    expect(second.projectId).toBe("project-1");
    expect(manager.list("project-1").map((item) => item.id)).toEqual([second.id]);
  });
});

describe("TerminalChatManager with sqlite", () => {
  it("creates a new terminal after the previous session is deleted", () => {
    const db = new Store(":memory:");
    const project = db.createProject({ name: "Demo", displayPath: "/tmp", realPath: "/tmp" });
    const session = db.createSession({ projectId: project.id, title: "shell 终端", kind: "terminal-chat" });
    const manager = new TerminalChatManager(db);
    const first = manager.create({ projectId: project.id, sessionId: session.id, title: session.title, cwd: "/tmp", profileId: "shell" });
    manager.remove(first.id);
    db.deleteSession(session.id);
    expect(db.getTerminalSession(first.id)).toBeUndefined();
    const nextSession = db.createSession({ projectId: project.id, title: "shell 终端", kind: "terminal-chat" });
    const second = manager.create({ projectId: project.id, sessionId: nextSession.id, title: nextSession.title, cwd: "/tmp", profileId: "shell" });
    expect(second.sessionId).toBe(nextSession.id);
    expect(manager.list(project.id)).toHaveLength(1);
    db.db.close();
  });
});
