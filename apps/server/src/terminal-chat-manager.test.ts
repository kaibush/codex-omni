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

import type { Store, TerminalSessionRow } from "@codex-omni/db";
import { TerminalChatManager } from "./terminal-chat-manager.js";

const row = (overrides: Partial<TerminalSessionRow> = {}): TerminalSessionRow => ({
  id: "terminal-1", sessionId: "session-1", projectId: "project-1", profileId: "shell", title: "Shell", cwd: "/tmp", desiredState: "running", state: "provisioning", restartPolicy: "manual", pid: null, lastSeq: 0, lastOutputAt: null, lastExitCode: null, lastSignal: null, restartCount: 0, restartWindowStartedAt: null, nextRestartAt: null, lastError: null, createdAt: 1, updatedAt: 1, stoppedAt: null, ...overrides
});

function makeStore() {
  let current = row();
  const events: Array<{ terminalId: string; seq: number; kind: string; data: string }> = [];
  return {
    store: {
      listTerminalSessions: () => [],
      createTerminalSession: () => current,
      updateTerminalSession: (_id: string, input: Partial<TerminalSessionRow>) => { current = { ...current, ...input }; return current; },
      updateSession: vi.fn(),
      addTerminalEvent: (event: typeof events[number]) => events.push(event),
      listTerminalEvents: (_id: string, after: number) => events.filter((event) => event.seq > after),
      listTerminalEventsBefore: (_id: string, before: number) => events.filter((event) => event.seq < before)
    } as unknown as Store,
    events
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
});
