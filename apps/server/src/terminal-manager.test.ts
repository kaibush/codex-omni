import { beforeEach, describe, expect, it, vi } from "vitest";

const ptyMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    writes: string[];
    resizes: Array<[number, number]>;
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
      pid: 4321,
      writes: [] as string[],
      resizes: [] as Array<[number, number]>,
      kills: [] as Array<string | undefined>,
      write(data: string) {
        this.writes.push(data);
      },
      resize(cols: number, rows: number) {
        this.resizes.push([cols, rows]);
      },
      kill(signal?: string) {
        this.kills.push(signal);
      },
      onData(handler: (data: string) => void) {
        dataHandlers.push(handler);
        return { dispose() {} };
      },
      onExit(handler: (event: { exitCode: number; signal?: number }) => void) {
        exitHandlers.push(handler);
        return { dispose() {} };
      },
      emitData(data: string) {
        for (const handler of dataHandlers) handler(data);
      },
      emitExit(exitCode: number, signal?: number) {
        for (const handler of exitHandlers)
          handler({ exitCode, ...(signal === undefined ? {} : { signal }) });
      }
    };
    ptyMocks.instances.push(instance);
    return instance;
  })
}));

import { TerminalManager } from "./terminal-manager.js";

beforeEach(() => {
  ptyMocks.instances.length = 0;
});

describe("TerminalManager", () => {
  it("keeps a PTY alive across browser subscriptions and replays missed output", () => {
    const manager = new TerminalManager();
    const terminal = manager.create({
      projectId: "project-1",
      projectName: "Project",
      cwd: "/tmp/project",
      cols: 80,
      rows: 24
    });
    const firstEvents: Array<Record<string, any>> = [];
    const firstSocket = {
      readyState: 1,
      OPEN: 1,
      send(data: string) {
        firstEvents.push(JSON.parse(data));
      }
    };
    manager.subscribe(terminal.id, firstSocket, 0);
    const process = ptyMocks.instances[0]!;
    process.emitData("one\r\n");
    expect(firstEvents.map((event) => event.type)).toEqual([
      "terminal.snapshot",
      "terminal.output"
    ]);
    manager.unsubscribeSocket(firstSocket);
    process.emitData("two\r\n");

    const reconnectEvents: Array<Record<string, any>> = [];
    const reconnectSocket = {
      readyState: 1,
      OPEN: 1,
      send(data: string) {
        reconnectEvents.push(JSON.parse(data));
      }
    };
    manager.subscribe(terminal.id, reconnectSocket, 1);
    expect(reconnectEvents[0]).toMatchObject({
      type: "terminal.snapshot",
      payload: { replay: true, output: "" }
    });
    expect(reconnectEvents[1]).toMatchObject({
      type: "terminal.output",
      seq: 2,
      payload: { data: "two\r\n" }
    });
    expect(manager.input(terminal.id, "pwd\r")).toBe(true);
    expect(process.writes).toEqual(["pwd\r"]);
    expect(manager.resize(terminal.id, 120, 40)).toBe(true);
    expect(process.resizes).toEqual([[120, 40]]);
    expect(manager.close(terminal.id)).toBe(true);
    expect(process.kills).toEqual(["SIGHUP"]);
  });

  it("reports exit metadata while retaining scrollback until the tab is closed", () => {
    const manager = new TerminalManager();
    const terminal = manager.create({
      projectId: "project-1",
      projectName: "Project",
      cwd: "/tmp/project"
    });
    const process = ptyMocks.instances[0]!;
    process.emitData("done\r\n");
    process.emitExit(7);
    expect(manager.get(terminal.id)).toMatchObject({
      status: "exited",
      exitCode: 7,
      seq: 1
    });
    expect(manager.input(terminal.id, "ignored")).toBe(false);
    expect(manager.list("project-1")).toHaveLength(1);
  });
});
