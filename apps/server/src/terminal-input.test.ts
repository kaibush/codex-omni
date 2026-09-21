import { afterEach, describe, expect, it, vi } from "vitest";
import {
  splitTrailingSubmit,
  TERMINAL_SUBMIT_DELAY_MS,
  writeTerminalInput
} from "./terminal-input.js";

afterEach(() => {
  vi.useRealTimers();
});

function session() {
  let timer: unknown = null;
  const writes: string[] = [];
  const write = (data: string) => writes.push(data);
  const send = (data: string, alive = () => true) => {
    writeTerminalInput(write, data, {
      getTimer: () => timer,
      setTimer: (next) => {
        timer = next;
      },
      alive
    });
  };
  return { writes, send, getTimer: () => timer };
}

describe("splitTrailingSubmit", () => {
  it("keeps a lone enter immediate", () => {
    expect(splitTrailingSubmit("\r")).toEqual({ body: "", submit: true });
    expect(splitTrailingSubmit("ls")).toEqual({ body: "ls", submit: false });
  });

  it("splits text from a trailing enter so TUI apps do not treat it as paste", () => {
    expect(splitTrailingSubmit("ls\r")).toEqual({ body: "ls", submit: true });
    expect(splitTrailingSubmit("one\rtwo\r")).toEqual({ body: "one\rtwo", submit: true });
  });
});

describe("writeTerminalInput", () => {
  it("writes a lone enter immediately", () => {
    const { writes, send, getTimer } = session();
    send("\r");
    expect(writes).toEqual(["\r"]);
    expect(getTimer()).toBeNull();
  });

  it("writes composer text before a delayed enter", () => {
    vi.useFakeTimers();
    const { writes, send, getTimer } = session();
    send("ls\r");
    expect(writes).toEqual(["ls"]);
    expect(getTimer()).not.toBeNull();
    vi.advanceTimersByTime(TERMINAL_SUBMIT_DELAY_MS);
    expect(writes).toEqual(["ls", "\r"]);
    expect(getTimer()).toBeNull();
  });

  it("flushes a pending enter before the next input", () => {
    vi.useFakeTimers();
    const { writes, send } = session();
    send("ls\r");
    send("pwd\r");
    expect(writes).toEqual(["ls", "\r", "pwd"]);
    vi.advanceTimersByTime(TERMINAL_SUBMIT_DELAY_MS);
    expect(writes).toEqual(["ls", "\r", "pwd", "\r"]);
  });

  it("does not send a second enter after the delayed submit already fired", () => {
    vi.useFakeTimers();
    const { writes, send } = session();
    send("ls\r");
    vi.advanceTimersByTime(TERMINAL_SUBMIT_DELAY_MS);
    send("a");
    expect(writes).toEqual(["ls", "\r", "a"]);
  });
});
