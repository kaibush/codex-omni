import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "@codex-omni/db";
import type { BridgeEvent } from "@codex-omni/protocol";

const runtimeMocks = vi.hoisted(() => ({
  run: vi.fn(),
  respond: vi.fn(() => false),
  cancel: vi.fn(() => false),
  shutdown: vi.fn(),
  active: false,
  runtime: null as null | {
    requestId: string;
    sessionId: string;
    workerPid: number | null;
    codexPid: number | null;
    startedAt: number;
    alive: boolean;
  }
}));

vi.mock("@codex-omni/codex-runtime", () => ({
  BridgeWorkerAdapter: class {
    async run(...args: unknown[]) {
      runtimeMocks.active = true;
      try {
        return await runtimeMocks.run(...args);
      } finally {
        runtimeMocks.active = false;
      }
    }
    respond() {
      return runtimeMocks.respond();
    }
    cancel() {
      runtimeMocks.active = false;
      return runtimeMocks.cancel();
    }
    isActive() {
      return runtimeMocks.active;
    }
    runtimeInfo() {
      return runtimeMocks.runtime;
    }
    listRuntimeInfo() {
      return runtimeMocks.runtime ? [runtimeMocks.runtime] : [];
    }
    shutdown() {
      runtimeMocks.shutdown();
    }
  },
  materializeProviderHome: vi.fn(async () => "/tmp/provider-home"),
  resolveProviderHome: vi.fn(async () => "/tmp/provider-home"),
  extractRolloutToolEvents: vi.fn(() => []),
  findRolloutFile: vi.fn(() => ""),
  runtimeKey: vi.fn(() => "runtime-key"),
  terminateRecordedWorker: vi.fn(() => true)
}));

import { RunManager } from "./run-manager.js";

let store: Store | undefined;
let manager: RunManager | undefined;

beforeEach(() => {
  runtimeMocks.run.mockReset();
  runtimeMocks.respond.mockReset();
  runtimeMocks.respond.mockReturnValue(false);
  runtimeMocks.cancel.mockReset();
  runtimeMocks.cancel.mockReturnValue(false);
  runtimeMocks.shutdown.mockReset();
  runtimeMocks.active = false;
  runtimeMocks.runtime = null;
});

afterEach(() => {
  manager?.shutdown();
  manager = undefined;
  store?.db.close();
  store = undefined;
});

function fixture() {
  store = new Store(":memory:");
  const provider = store.upsertProvider({ name: "Provider" });
  const project = store.createProject({
    name: "Project",
    displayPath: "/tmp/project",
    realPath: "/tmp/project",
    providerId: provider.id
  });
  const session = store.createSession({ projectId: project.id, providerId: provider.id });
  const sent: Array<Record<string, any>> = [];
  const socket = {
    readyState: 1,
    OPEN: 1,
    send(data: string) {
      sent.push(JSON.parse(data));
    }
  };
  return { provider, project, session, socket, sent };
}

function bridgeEvent(input: Pick<BridgeEvent, "type" | "payload"> & { seq: number }): BridgeEvent {
  return {
    protocolVersion: 1,
    requestId: "request-1",
    projectId: "project-1",
    sessionId: "session-1",
    seq: input.seq,
    type: input.type,
    payload: input.payload
  };
}

describe("RunManager reconnect state", () => {
  it("keeps the run active while Codex reconnects and clears the notice on progress", async () => {
    const { project, provider, session, socket, sent } = fixture();
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "run.reconnecting",
            payload: {
              status: "running",
              message: "Reconnecting... 4/5 (temporary stream disconnect)",
              attempt: 4,
              maxAttempts: 5,
              reason: "temporary stream disconnect"
            }
          })
        );
        expect(store?.getSession(session.id)?.status).toBe("running");
        expect(JSON.parse(store?.getLatestRunMessage(session.id)?.dataJson ?? "{}")).toMatchObject({
          status: "running",
          reconnecting: { attempt: 4, maxAttempts: 5 }
        });

        onEvent(
          bridgeEvent({
            seq: 2,
            type: "assistant.delta",
            payload: { itemId: "answer-1", text: "继续响应", phase: "updated" }
          })
        );
        expect(
          JSON.parse(store?.getLatestRunMessage(session.id)?.dataJson ?? "{}").reconnecting
        ).toBeUndefined();
        onEvent(
          bridgeEvent({
            seq: 3,
            type: "turn.completed",
            payload: { status: "completed", startedAt: 1, endedAt: 2, usage: {} }
          })
        );
      }
    );

    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "hello"
      },
      socket
    );

    expect(store?.getSession(session.id)?.status).toBe("idle");
    expect(JSON.parse(store?.getLatestRunMessage(session.id)?.dataJson ?? "{}")).toMatchObject({
      status: "completed",
      runId: store?.getLatestRun(session.id)?.id
    });
    expect(sent.filter((event) => event.type === "run.reconnecting")).toHaveLength(1);
    expect(sent.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });

  it("marks the run failed only after a terminal failure", async () => {
    const { project, provider, session, socket, sent } = fixture();
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "run.reconnecting",
            payload: {
              status: "running",
              message: "Reconnecting... 5/5 (temporary stream disconnect)",
              attempt: 5,
              maxAttempts: 5
            }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 2,
            type: "run.failed",
            payload: {
              status: "failed",
              message: "stream retries exhausted",
              endedAt: 3
            }
          })
        );
        throw new Error("Bridge worker exited with 1");
      }
    );

    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "hello"
      },
      socket
    );

    expect(store?.getSession(session.id)?.status).toBe("failed");
    expect(sent.filter((event) => event.type === "run.failed")).toHaveLength(1);
    expect(
      store?.listMessages(session.id).filter((message) => message.role === "error")
    ).toHaveLength(1);
    expect(JSON.parse(store?.getLatestRunMessage(session.id)?.dataJson ?? "{}")).toMatchObject({
      status: "failed",
      reason: "stream retries exhausted"
    });
  });
});

describe("RunManager recovery and queue", () => {
  it("locks a session before persisting a second concurrent user message", async () => {
    const { project, provider, session, socket } = fixture();
    let release!: () => void;
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "turn.completed",
            payload: { status: "completed", endedAt: Date.now(), usage: {} }
          })
        );
      }
    );
    manager = new RunManager(store!, "/tmp/runtime");
    const first = manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "first"
      },
      socket
    );
    await vi.waitFor(() => expect(runtimeMocks.run).toHaveBeenCalledTimes(1));
    await expect(
      manager.handle(
        {
          type: "turn.start",
          projectId: project.id,
          sessionId: session.id,
          providerId: provider.id,
          message: "second"
        },
        socket
      )
    ).rejects.toThrow("active turn");
    expect(
      store?.listMessages(session.id).filter((message) => message.role === "user")
    ).toHaveLength(1);
    expect(manager.listActiveRuns()[0]?.subscriberCount).toBe(1);
    manager.unsubscribeSocket(socket);
    expect(manager.listActiveRuns()[0]?.subscriberCount).toBe(0);
    release();
    await first;
  });

  it("restores a snapshot, replays missing events and resolves a pending approval", async () => {
    const { project, provider, session, socket } = fixture();
    let release!: () => void;
    runtimeMocks.respond.mockReturnValue(true);
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "assistant.delta",
            payload: { itemId: "answer-1", text: "partial", firstResponseAt: 12_345 }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 2,
            type: "approval.requested",
            payload: {
              itemId: "command-1",
              approvalId: "approval-1",
              tool: "command",
              command: "pnpm test"
            }
          })
        );
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        onEvent(
          bridgeEvent({
            seq: 3,
            type: "turn.completed",
            payload: { status: "completed", endedAt: Date.now(), usage: {} }
          })
        );
      }
    );
    manager = new RunManager(store!, "/tmp/runtime");
    const running = manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "run"
      },
      socket
    );
    await vi.waitFor(() => expect(store?.listPendingApprovals(session.id)).toHaveLength(1));
    const persistedRunState = JSON.parse(store?.getLatestRunMessage(session.id)?.dataJson ?? "{}");
    expect(persistedRunState).toMatchObject({
      status: "running",
      firstResponseAt: 12_345,
      runId: store?.getLatestRun(session.id)?.id
    });
    const replayed: Array<Record<string, any>> = [];
    const reconnectSocket = {
      readyState: 1,
      OPEN: 1,
      send(data: string) {
        replayed.push(JSON.parse(data));
      }
    };
    const run = store?.getLatestRun(session.id);
    await manager.handle(
      {
        type: "session.subscribe",
        sessionId: session.id,
        lastRequestId: run?.id,
        lastSeq: 0
      },
      reconnectSocket
    );
    expect(replayed[0]).toMatchObject({
      type: "session.snapshot",
      payload: {
        session: { status: "running" },
        approvals: [{ id: "approval-1", command: "pnpm test" }]
      }
    });
    expect(replayed.some((event) => event.type === "assistant.delta" && event.seq === 1)).toBe(
      true
    );
    expect(replayed.some((event) => event.type === "approval.requested" && event.seq === 2)).toBe(
      true
    );
    await manager.handle(
      {
        type: "approval.respond",
        sessionId: session.id,
        requestId: "approval-1",
        decision: "accept"
      },
      reconnectSocket
    );
    expect(store?.getApproval("approval-1")?.status).toBe("accepted");
    expect(replayed.some((event) => event.type === "approval.resolved")).toBe(true);
    release();
    await running;
  });

  it("runs queued turns in order and keeps later turns on the server", async () => {
    const { project, provider, session, socket } = fixture();
    const pending: Array<{ resolve: () => void; onEvent: (event: BridgeEvent) => void }> = [];
    runtimeMocks.run.mockImplementation(
      (_request: unknown, onEvent: (event: BridgeEvent) => void) =>
        new Promise<void>((resolve) => pending.push({ resolve, onEvent }))
    );
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.enqueue",
        clientId: "queue-1",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "first"
      },
      socket
    );
    await vi.waitFor(() => expect(runtimeMocks.run).toHaveBeenCalledTimes(1));
    await manager.handle(
      {
        type: "turn.enqueue",
        clientId: "queue-2",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "second"
      },
      socket
    );
    expect(store?.listQueuedTurns(session.id).map((item) => item.message)).toEqual(["second"]);
    pending[0]?.onEvent(
      bridgeEvent({
        seq: 1,
        type: "turn.completed",
        payload: { status: "completed", endedAt: Date.now(), usage: {} }
      })
    );
    pending[0]?.resolve();
    await vi.waitFor(() => expect(runtimeMocks.run).toHaveBeenCalledTimes(2));
    expect(store?.listQueuedTurns(session.id)).toEqual([]);
    pending[1]?.onEvent(
      bridgeEvent({
        seq: 1,
        type: "turn.completed",
        payload: { status: "completed", endedAt: Date.now(), usage: {} }
      })
    );
    pending[1]?.resolve();
    await vi.waitFor(() => expect(store?.getSession(session.id)?.status).toBe("idle"));
    expect(
      store
        ?.listMessages(session.id)
        .filter((message) => message.role === "user")
        .map((message) => message.content)
    ).toEqual(["first", "second"]);
  });

  it("reorders queued turns that have not started yet", async () => {
    const { project, provider, session, socket } = fixture();
    const pending: Array<{ resolve: () => void; onEvent: (event: BridgeEvent) => void }> = [];
    runtimeMocks.run.mockImplementation(
      (_request: unknown, onEvent: (event: BridgeEvent) => void) =>
        new Promise<void>((resolve) => pending.push({ resolve, onEvent }))
    );
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.enqueue",
        clientId: "queue-1",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "first"
      },
      socket
    );
    await vi.waitFor(() => expect(runtimeMocks.run).toHaveBeenCalledTimes(1));
    await manager.handle(
      {
        type: "turn.enqueue",
        clientId: "queue-2",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "second"
      },
      socket
    );
    await manager.handle(
      {
        type: "turn.enqueue",
        clientId: "queue-3",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "third"
      },
      socket
    );
    expect(store?.listQueuedTurns(session.id).map((item) => item.message)).toEqual([
      "second",
      "third"
    ]);
    await manager.handle(
      { type: "queue.move", sessionId: session.id, queueId: "queue-3", direction: "up" },
      socket
    );
    expect(store?.listQueuedTurns(session.id).map((item) => item.message)).toEqual([
      "third",
      "second"
    ]);
    pending[0]?.onEvent(
      bridgeEvent({
        seq: 1,
        type: "turn.completed",
        payload: { status: "completed", endedAt: Date.now(), usage: {} }
      })
    );
    pending[0]?.resolve();
    await vi.waitFor(() => expect(runtimeMocks.run).toHaveBeenCalledTimes(2));
    expect(runtimeMocks.run.mock.calls[1]?.[0]).toMatchObject({ message: "third" });
    pending[1]?.onEvent(
      bridgeEvent({
        seq: 1,
        type: "turn.completed",
        payload: { status: "completed", endedAt: Date.now(), usage: {} }
      })
    );
    pending[1]?.resolve();
  });

  it("deduplicates a queued command that is retried after it already started", async () => {
    const { project, provider, session, socket } = fixture();
    let release!: () => void;
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "turn.completed",
            payload: { status: "completed", endedAt: Date.now(), usage: {} }
          })
        );
      }
    );
    manager = new RunManager(store!, "/tmp/runtime");
    const command = {
      type: "turn.enqueue" as const,
      clientId: "stable-client-id",
      projectId: project.id,
      sessionId: session.id,
      providerId: provider.id,
      message: "once"
    };
    await manager.handle(command, socket);
    await vi.waitFor(() => expect(runtimeMocks.run).toHaveBeenCalledTimes(1));
    await manager.handle(command, socket);
    expect(runtimeMocks.run).toHaveBeenCalledTimes(1);
    expect(store?.listQueuedTurns(session.id)).toEqual([]);
    expect(
      store?.listMessages(session.id).filter((message) => message.role === "user")
    ).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(store?.getSession(session.id)?.status).toBe("idle"));
  });
});

describe("RunManager fake runtime", () => {
  it("streams a fake assistant reply without starting Codex", async () => {
    const previous = process.env.CODEX_OMNI_FAKE_RUNTIME;
    process.env.CODEX_OMNI_FAKE_RUNTIME = "1";
    try {
      const { project, provider, session, socket } = fixture();
      manager = new RunManager(store!, "/tmp/runtime");
      await manager.handle(
        {
          type: "turn.start",
          projectId: project.id,
          sessionId: session.id,
          providerId: provider.id,
          message: "hello stream"
        },
        socket
      );
      expect(runtimeMocks.run).not.toHaveBeenCalled();
      const assistant = store
        ?.listMessages(session.id)
        .find((message) => message.role === "assistant");
      expect(assistant?.content).toBe("已收到：hello stream");
      expect(store?.getSession(session.id)?.status).toBe("idle");
    } finally {
      if (previous === undefined) delete process.env.CODEX_OMNI_FAKE_RUNTIME;
      else process.env.CODEX_OMNI_FAKE_RUNTIME = previous;
    }
  });
});

describe("RunManager stream patches", () => {
  it("folds assistant deltas without storing accumulated text on each event", async () => {
    const { project, provider, session, socket, sent } = fixture();
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "assistant.delta",
            payload: { itemId: "answer-1", delta: "hel" }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 2,
            type: "assistant.delta",
            payload: { itemId: "answer-1", delta: "lo" }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 3,
            type: "assistant.completed",
            payload: { itemId: "answer-1", text: "hello" }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 4,
            type: "turn.completed",
            payload: { status: "completed", endedAt: Date.now(), usage: {} }
          })
        );
      }
    );
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "hi"
      },
      socket
    );
    const assistant = store
      ?.listMessages(session.id)
      .find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("hello");
    const deltas = sent.filter((event) => event.type === "assistant.delta");
    expect(deltas.map((event) => event.payload.delta)).toEqual(["hel", "lo"]);
    expect(deltas.every((event) => event.payload.text == null)).toBe(true);
  });
});
