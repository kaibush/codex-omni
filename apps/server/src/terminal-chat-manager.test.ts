import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import * as pty from "node-pty";
import { Store, type TerminalSessionRow } from "@codex-omni/db";
import { TERMINAL_SUBMIT_DELAY_MS } from "./terminal-input.js";
import { TerminalChatManager, terminalSnapshotFromEvents } from "./terminal-chat-manager.js";

const row = (overrides: Partial<TerminalSessionRow> = {}): TerminalSessionRow => ({
  id: "terminal-1", sessionId: "session-1", projectId: "project-1", profileId: "shell", command: "", title: "Shell", cwd: "/tmp", desiredState: "running", state: "provisioning", restartPolicy: "manual", pid: null, lastSeq: 0, lastOutputAt: null, lastExitCode: null, lastSignal: null, restartCount: 0, restartWindowStartedAt: null, nextRestartAt: null, lastError: null, createdAt: 1, updatedAt: 1, stoppedAt: null, ...overrides
});

const defaultProfiles = {
  shell: { id: "shell", name: "Shell", command: "", sortOrder: 2, createdAt: 1, updatedAt: 1 },
  codex: { id: "codex", name: "Codex", command: "codex", sortOrder: 0, createdAt: 1, updatedAt: 1 },
  "claude-code": { id: "claude-code", name: "Claude Code", command: "claude", sortOrder: 1, createdAt: 1, updatedAt: 1 }
};

function makeStore() {
  const rows = new Map<string, TerminalSessionRow>();
  const sessions = new Set<string>(["session-1"]);
  const events: Array<{ terminalId: string; seq: number; kind: string; data: string }> = [];
  const profiles = { ...defaultProfiles };
  let nextId = 1;
  return {
    profiles,
    store: {
      listTerminalSessions: (projectId?: string) => [...rows.values()].filter((item) => !projectId || item.projectId === projectId),
      getTerminalProfile: (id: string) => profiles[id as keyof typeof profiles],
      createTerminalSession: (input: { projectId: string; sessionId: string; title: string; cwd: string; profileId: string; command?: string }) => {
        const created = row({
          id: `terminal-${nextId++}`,
          ...input,
          command: input.command ?? profiles[input.profileId as keyof typeof profiles]?.command ?? "",
          state: "provisioning"
        });
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

afterEach(() => { vi.useRealTimers(); });

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

  it("does not incrementally replay after the server restarts a PTY", () => {
    const { store } = makeStore();
    const manager = new TerminalChatManager(store);
    const terminal = manager.create({ projectId: "project-1", sessionId: "session-1", title: "Shell", cwd: "/tmp", profileId: "shell" });
    ptyMocks.instances[0]!.emitData("old-tui\r\n");
    const restored = new TerminalChatManager(store);
    restored.restore();
    ptyMocks.instances.at(-1)!.emitData("new-tui\r\n");
    const replay: Array<Record<string, any>> = [];
    restored.subscribe(terminal.id, { readyState: 1, OPEN: 1, send(data: string) { replay.push(JSON.parse(data)); } }, 1);
    expect(replay[0]).toMatchObject({ type: "terminal.snapshot", payload: { output: "new-tui\r\n", replay: false, firstSeq: 1 } });
    const cold: Array<Record<string, any>> = [];
    restored.subscribe(terminal.id, { readyState: 1, OPEN: 1, send(data: string) { cold.push(JSON.parse(data)); } }, 0);
    expect(cold[0]).toMatchObject({ type: "terminal.snapshot", payload: { output: "new-tui\r\n", replay: false, firstSeq: 1 } });
  });

  it("drops pre-restart output after a manual restart", () => {
    const { store } = makeStore();
    const manager = new TerminalChatManager(store);
    const terminal = manager.create({ projectId: "project-1", sessionId: "session-1", title: "Shell", cwd: "/tmp", profileId: "shell" });
    ptyMocks.instances[0]!.emitData("old-tui\r\n");
    manager.restart(terminal.id);
    ptyMocks.instances[1]!.emitData("new-tui\r\n");
    const replay: Array<Record<string, any>> = [];
    manager.subscribe(terminal.id, { readyState: 1, OPEN: 1, send(data: string) { replay.push(JSON.parse(data)); } }, 1);
    expect(replay[0]).toMatchObject({ type: "terminal.snapshot", payload: { output: "new-tui\r\n", replay: false, firstSeq: 1 } });
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

  it("launches custom profile commands through the login shell", () => {
    const { store } = makeStore();
    const manager = new TerminalChatManager(store);
    manager.create({
      projectId: "project-1",
      sessionId: "session-1",
      title: "Claude Code",
      cwd: "/tmp",
      profileId: "claude-code"
    });
    expect(pty.spawn).toHaveBeenCalled();
    const args = vi.mocked(pty.spawn).mock.calls.at(-1)?.[1];
    expect(args).toEqual(expect.arrayContaining(["-c", "claude"]));
  });

  it("restarts with the live profile command after it is edited", () => {
    const { store, profiles } = makeStore();
    const manager = new TerminalChatManager(store);
    const terminal = manager.create({
      projectId: "project-1",
      sessionId: "session-1",
      title: "Claude Code",
      cwd: "/tmp",
      profileId: "claude-code"
    });
    profiles["claude-code"] = {
      ...profiles["claude-code"],
      command: "IS_SANDBOX=1 claude --dangerously-skip-permissions --settings ~/.claude/settings.grok.json"
    };
    manager.restart(terminal.id);
    const args = vi.mocked(pty.spawn).mock.calls.at(-1)?.[1];
    expect(args).toEqual(expect.arrayContaining([
      "-c",
      "IS_SANDBOX=1 claude --dangerously-skip-permissions --settings ~/.claude/settings.grok.json"
    ]));
  });

  it("keeps using the session snapshot after the profile is deleted", () => {
    const { store, profiles } = makeStore();
    const manager = new TerminalChatManager(store);
    const terminal = manager.create({
      projectId: "project-1",
      sessionId: "session-1",
      title: "Claude Code",
      cwd: "/tmp",
      profileId: "claude-code"
    });
    delete (profiles as Record<string, unknown>)["claude-code"];
    manager.restart(terminal.id);
    const args = vi.mocked(pty.spawn).mock.calls.at(-1)?.[1];
    expect(args).toEqual(expect.arrayContaining(["-c", "claude"]));
  });

  it("writes composer text before a delayed enter so TUI apps submit", () => {
    vi.useFakeTimers();
    const { store } = makeStore();
    const manager = new TerminalChatManager(store);
    const terminal = manager.create({ projectId: "project-1", sessionId: "session-1", title: "Shell", cwd: "/tmp", profileId: "shell" });
    const process = ptyMocks.instances[0]!;
    expect(manager.input(terminal.id, "ls\r")).toBe(true);
    expect(process.writes).toEqual(["ls"]);
    vi.advanceTimersByTime(TERMINAL_SUBMIT_DELAY_MS);
    expect(process.writes).toEqual(["ls", "\r"]);
    vi.useRealTimers();
  });

  it("sends a lone enter immediately", () => {
    const { store } = makeStore();
    const manager = new TerminalChatManager(store);
    const terminal = manager.create({ projectId: "project-1", sessionId: "session-1", title: "Shell", cwd: "/tmp", profileId: "shell" });
    expect(manager.input(terminal.id, "\r")).toBe(true);
    expect(ptyMocks.instances[0]!.writes).toEqual(["\r"]);
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

  it("relocates a project cwd and restarts running terminals", () => {
    const { store } = makeStore();
    const manager = new TerminalChatManager(store);
    const terminal = manager.create({ projectId: "project-1", sessionId: "session-1", title: "Shell", cwd: "/tmp/grok-iq", profileId: "shell" });
    expect(ptyMocks.instances).toHaveLength(1);
    const updated = manager.relocateProject("project-1", "/tmp/grok-iq", "/tmp/grok-iq-plus");
    expect(updated).toEqual([terminal.id]);
    expect(manager.get(terminal.id)?.cwd).toBe("/tmp/grok-iq-plus");
    expect(ptyMocks.instances).toHaveLength(2);
    expect(ptyMocks.instances[0]!.kills).toContain("SIGTERM");
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

describe("terminalSnapshotFromEvents", () => {
  it("keeps incremental replay when the PTY did not restart", () => {
    expect(terminalSnapshotFromEvents([
      { seq: 2, kind: "output", data: "more" }
    ], 1, 2)).toEqual({ output: "more", firstSeq: 2, replay: true, truncated: false });
  });

  it("drops output before the latest restart marker", () => {
    expect(terminalSnapshotFromEvents([
      { seq: 1, kind: "output", data: "old-tui" },
      { seq: 2, kind: "marker", data: "Server 已重启，正在恢复终端进程" },
      { seq: 3, kind: "output", data: "new-tui" }
    ], 1, 3)).toEqual({ output: "new-tui", firstSeq: 1, replay: false, truncated: false });
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
