import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "@codex-omni/db";
import type { BridgeEvent } from "@codex-omni/protocol";

const runtimeMocks = vi.hoisted(() => ({
  run: vi.fn(),
  respond: vi.fn(() => false),
  steer: vi.fn((..._args: unknown[]) => true),
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

vi.mock("@codex-omni/codex-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@codex-omni/codex-runtime")>()),
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
    steer(...args: unknown[]) {
      return runtimeMocks.steer(...args);
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
  INCOMPLETE_TURN_MESSAGE: "Codex 流在 turn.completed 前结束，任务未完成",
  terminateRecordedWorker: vi.fn(() => true)
}));

import { terminateRecordedWorker } from "@codex-omni/codex-runtime";
import { RunManager } from "./run-manager.js";

let store: Store | undefined;
let manager: RunManager | undefined;
const tempDirs: string[] = [];

beforeEach(() => {
  runtimeMocks.run.mockReset();
  runtimeMocks.respond.mockReset();
  runtimeMocks.respond.mockReturnValue(false);
  runtimeMocks.steer.mockReset();
  runtimeMocks.steer.mockReturnValue(true);
  runtimeMocks.cancel.mockReset();
  runtimeMocks.cancel.mockReturnValue(false);
  runtimeMocks.shutdown.mockReset();
  runtimeMocks.active = false;
  runtimeMocks.runtime = null;
  vi.mocked(terminateRecordedWorker).mockClear();
});

afterEach(() => {
  manager?.shutdown();
  manager = undefined;
  store?.db.close();
  store = undefined;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(root = "/tmp/project") {
  store = new Store(":memory:");
  const provider = store.upsertProvider({ name: "Provider" });
  const project = store.createProject({
    name: "Project",
    displayPath: root,
    realPath: root,
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

function attachmentFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "omni-attachment-run-"));
  tempDirs.push(dir);
  const root = path.join(dir, "project");
  mkdirSync(path.join(root, ".codex-uploads"), { recursive: true });
  const imagePath = path.join(root, ".codex-uploads", "shot.png");
  writeFileSync(imagePath, "image");
  const outside = path.join(dir, "secret.png");
  writeFileSync(outside, "outside");
  return { ...fixture(root), imagePath, outside };
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

describe("RunManager terminal state", () => {
  it.each([false, true])(
    "fails EOF with execution output=%s instead of completing",
    async (withTool) => {
      const { project, session, socket, sent } = fixture();
      runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
        if (withTool)
          onEvent(
            bridgeEvent({
              seq: 1,
              type: "tool.output",
              payload: {
                itemId: "tool",
                tool: "command",
                output: "partial execution",
                status: "completed"
              }
            })
          );
      });
      manager = new RunManager(store!, "/tmp/runtime");
      await manager.handle(
        {
          type: "turn.start",
          projectId: project.id,
          sessionId: session.id,
          message: "continue work"
        },
        socket
      );
      expect(store!.getLatestRun(session.id)).toMatchObject({ status: "failed" });
      expect(store!.getSession(session.id)?.status).toBe("failed");
      expect(sent.some((event) => event.type === "turn.completed")).toBe(false);
      expect(sent.find((event) => event.type === "run.failed")?.payload.reason).toContain(
        "turn.completed"
      );
    }
  );

  it("keeps completion provisional if the worker subsequently exits abnormally", async () => {
    const { project, session, socket, sent } = fixture();
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      onEvent(bridgeEvent({ seq: 1, type: "turn.completed", payload: { usage: {} } }));
      expect(store!.getSession(session.id)?.status).toBe("running");
      throw new Error("worker crashed while draining stdout");
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        message: "work"
      },
      socket
    );
    expect(store!.getLatestRun(session.id)).toMatchObject({
      status: "failed",
      reason: "worker crashed while draining stdout"
    });
    expect(sent.some((event) => event.type === "turn.completed")).toBe(false);
  });

  it("does not retry a failed continuation or accept a later completion", async () => {
    const { project, session, socket, sent } = fixture();
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      onEvent(bridgeEvent({ seq: 1, type: "run.failed", payload: { message: "upstream failed" } }));
      onEvent(bridgeEvent({ seq: 2, type: "turn.completed", payload: {} }));
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        message: "继续"
      },
      socket
    );
    expect(runtimeMocks.run).toHaveBeenCalledTimes(1);
    expect(store!.getLatestRun(session.id)?.status).toBe("failed");
    expect(sent.some((event) => event.type === "turn.completed")).toBe(false);
  });

  it("ignores completion and output after cancellation", async () => {
    const { project, session, socket, sent } = fixture();
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      manager!.cancel(session.id);
      onEvent(
        bridgeEvent({
          seq: 1,
          type: "assistant.completed",
          payload: { itemId: "late", text: "late" }
        })
      );
      onEvent(bridgeEvent({ seq: 2, type: "turn.completed", payload: {} }));
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        message: "继续"
      },
      socket
    );
    expect(store!.getLatestRun(session.id)?.status).toBe("cancelled");
    expect(runtimeMocks.run).toHaveBeenCalledTimes(1);
    expect(
      sent.some((event) => ["turn.completed", "assistant.completed"].includes(event.type))
    ).toBe(false);
  });

  it("publishes completion after trailing tool output with an increasing replay cursor", async () => {
    const { project, session, socket, sent } = fixture();
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      onEvent(
        bridgeEvent({ seq: 1, type: "turn.completed", payload: { usage: { input_tokens: 1 } } })
      );
      onEvent(
        bridgeEvent({
          seq: 2,
          type: "tool.output",
          payload: { itemId: "tool", tool: "command", output: "done" }
        })
      );
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        message: "work"
      },
      socket
    );
    const terminal = sent.find((event) => event.type === "turn.completed")!;
    expect(terminal.seq).toBe(3);
    expect(store!.getLatestRun(session.id)).toMatchObject({ status: "completed", lastSeq: 3 });
  });
});

describe("RunManager runtime inputs", () => {
  it("forwards provider-specific model limits without applying guesses to other providers", async () => {
    const { provider, project, session, socket } = fixture();
    store!.upsertProvider({ ...provider, contextWindow: 32000, autoCompactTokenLimit: 28000 });
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      onEvent(bridgeEvent({ seq: 1, type: "turn.completed", payload: {} }));
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      { type: "turn.start", projectId: project.id, sessionId: session.id, message: "hi" },
      socket
    );
    expect(runtimeMocks.run.mock.calls[0]?.[0]).toMatchObject({
      contextWindow: 32000,
      autoCompactTokenLimit: 28000
    });
    store!.upsertProvider({ ...provider, contextWindow: null, autoCompactTokenLimit: null });
    await manager.handle(
      { type: "turn.start", projectId: project.id, sessionId: session.id, message: "hi" },
      socket
    );
    expect(runtimeMocks.run.mock.calls[1]?.[0]).not.toHaveProperty("contextWindow");
    expect(runtimeMocks.run.mock.calls[1]?.[0]).not.toHaveProperty("autoCompactTokenLimit");
  });

  it("persists and broadcasts attachments, and restores them and run options by message id", async () => {
    const { project, session, socket, sent, imagePath } = attachmentFixture();
    const attachments = [{ name: "shot.png", path: imagePath, kind: "image" as const }];
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      onEvent(bridgeEvent({ seq: 1, type: "turn.completed", payload: {} }));
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        message: "inspect",
        model: "image-model",
        sandbox: "read-only",
        approvalPolicy: "on-request",
        networkAccessEnabled: false,
        attachments: [{ ...attachments[0]!, path: ".codex-uploads/shot.png" }]
      },
      socket
    );
    const user = store!.listMessages(session.id).find((message) => message.role === "user")!;
    expect(JSON.parse(user.dataJson!)).toMatchObject({ attachments });
    expect(sent.find((event) => event.type === "user.message")?.payload.attachments).toEqual(
      attachments
    );
    await manager.handle(
      {
        type: "run.retry",
        projectId: project.id,
        sessionId: session.id,
        messageId: user.id,
        message: user.content
      },
      socket
    );
    expect(runtimeMocks.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attachments,
        model: "image-model",
        sandbox: "read-only",
        approvalPolicy: "on-request",
        networkAccessEnabled: false
      }),
      expect.any(Function),
      expect.any(Function)
    );
    expect(runtimeMocks.run).toHaveBeenCalledTimes(2);
  });

  it("forwards explicit retry attachments without weakening runtime defaults", async () => {
    const { project, session, socket, imagePath } = attachmentFixture();
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      onEvent(bridgeEvent({ seq: 1, type: "turn.completed", payload: {} }));
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "run.retry",
        projectId: project.id,
        sessionId: session.id,
        message: "inspect",
        attachments: [{ name: "shot.png", path: imagePath, kind: "image" }]
      },
      socket
    );
    expect(runtimeMocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ name: "shot.png", path: imagePath, kind: "image" }],
        approvalPolicy: "on-request"
      }),
      expect.any(Function),
      expect.any(Function)
    );
  });

  it.each(["turn.start", "turn.enqueue", "run.retry"] as const)(
    "rejects outside attachments before %s has side effects",
    async (type) => {
      const { project, session, socket, outside } = attachmentFixture();
      manager = new RunManager(store!, "/tmp/runtime");
      await expect(
        manager.handle(
          {
            type,
            projectId: project.id,
            sessionId: session.id,
            message: "inspect",
            attachments: [{ name: "secret.png", path: outside, kind: "image" }]
          },
          socket
        )
      ).rejects.toThrow("inside the project");
      expect(runtimeMocks.run).not.toHaveBeenCalled();
      expect(store!.getLatestRun(session.id)).toBeUndefined();
      expect(store!.listMessages(session.id)).toEqual([]);
      expect(store!.listQueuedTurns(session.id)).toEqual([]);
    }
  );

  it("revalidates queued files after a symlink replacement and keeps the queue for correction", async () => {
    const { project, session, socket, sent, imagePath, outside } = attachmentFixture();
    manager = new RunManager(store!, "/tmp/runtime");
    runtimeMocks.active = true;
    await manager.handle(
      {
        type: "turn.enqueue",
        projectId: project.id,
        sessionId: session.id,
        message: "inspect",
        attachments: [{ name: "shot.png", path: imagePath, kind: "image" }]
      },
      socket
    );
    rmSync(imagePath);
    symlinkSync(outside, imagePath);
    runtimeMocks.active = false;
    await manager.handle({ type: "queue.start-next", sessionId: session.id }, socket);
    await vi.waitFor(() => expect(sent.some((event) => event.type === "server.error")).toBe(true));
    expect(runtimeMocks.run).not.toHaveBeenCalled();
    expect(store!.listQueuedTurns(session.id)).toHaveLength(1);
    expect(store!.getLatestRun(session.id)).toBeUndefined();
  });

  it("rejects retry metadata from another session", async () => {
    const { project, session, socket } = attachmentFixture();
    const other = store!.createSession({ projectId: project.id });
    const source = store!.addMessage({
      sessionId: other.id,
      role: "user",
      content: "other",
      providerId: null,
      eventType: "user.message"
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await expect(
      manager.handle(
        {
          type: "run.retry",
          projectId: project.id,
          sessionId: session.id,
          message: "inspect",
          messageId: source.id
        },
        socket
      )
    ).rejects.toThrow("does not belong to this session");
    expect(runtimeMocks.run).not.toHaveBeenCalled();
  });
});

describe("RunManager startup reconcile", () => {
  it("only terminates workers for this service instance on startup", () => {
    const previous = process.env.CODEX_OMNI_INSTANCE;
    process.env.CODEX_OMNI_INSTANCE = "prod";
    try {
      const { project, session } = fixture();
      const other = store!.createSession({ projectId: project.id });
      store!.updateSession(session.id, { status: "running" });
      store!.updateSession(other.id, { status: "running" });
      store!.createRun({
        id: "run-prod",
        sessionId: session.id,
        projectId: project.id,
        serviceInstanceId: "prod",
        cwd: "/tmp/project",
        startedAt: Date.now()
      });
      store!.createRun({
        id: "run-dev",
        sessionId: other.id,
        projectId: project.id,
        serviceInstanceId: "dev",
        cwd: "/tmp/project",
        startedAt: Date.now()
      });
      store!.updateRun("run-prod", { workerPid: 4242 });
      store!.updateRun("run-dev", { workerPid: 4343 });
      manager = new RunManager(store!, "/tmp/runtime");
      expect(manager.reconcileStartup()).toBe(1);
      expect(terminateRecordedWorker).toHaveBeenCalledWith(4242, "run-prod");
      expect(terminateRecordedWorker).not.toHaveBeenCalledWith(4343, "run-dev");
      expect(store?.getSession(session.id)?.status).toBe("interrupted");
      expect(store?.getSession(other.id)?.status).toBe("running");
    } finally {
      if (previous === undefined) delete process.env.CODEX_OMNI_INSTANCE;
      else process.env.CODEX_OMNI_INSTANCE = previous;
    }
  });
});

describe("RunManager service instance isolation", () => {
  it("does not mark another service instance's running session as interrupted on subscribe", async () => {
    const previous = process.env.CODEX_OMNI_INSTANCE;
    process.env.CODEX_OMNI_INSTANCE = "dev";
    try {
      const { project, session, socket, sent } = fixture();
      store!.updateSession(session.id, { status: "running" });
      store!.createRun({
        id: "run-prod",
        sessionId: session.id,
        projectId: project.id,
        serviceInstanceId: "prod",
        cwd: project.realPath,
        startedAt: Date.now()
      });
      manager = new RunManager(store!, "/tmp/runtime");
      await manager.handle({ type: "session.subscribe", sessionId: session.id }, socket);
      expect(store!.getLatestRun(session.id)).toMatchObject({
        status: "running",
        serviceInstanceId: "prod"
      });
      expect(store!.getSession(session.id)?.status).toBe("running");
      expect(sent[0]).toMatchObject({
        type: "session.snapshot",
        payload: { session: { status: "running" }, run: { status: "running" } }
      });
    } finally {
      if (previous === undefined) delete process.env.CODEX_OMNI_INSTANCE;
      else process.env.CODEX_OMNI_INSTANCE = previous;
    }
  });

  it("cleans up an orphan worker when the persisted run is already interrupted", async () => {
    const { project, session, socket } = fixture();
    store!.updateSession(session.id, { status: "running" });
    store!.createRun({
      id: "run-orphan",
      sessionId: session.id,
      projectId: project.id,
      serviceInstanceId: "test",
      cwd: project.realPath,
      startedAt: Date.now()
    });
    store!.updateRun("run-orphan", { status: "interrupted", endedAt: Date.now() });
    runtimeMocks.active = true;
    runtimeMocks.cancel.mockReturnValue(true);
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      onEvent(bridgeEvent({ seq: 1, type: "turn.completed", payload: {} }));
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      { type: "turn.start", projectId: project.id, sessionId: session.id, message: "执行工作" },
      socket
    );
    expect(runtimeMocks.cancel).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.run).toHaveBeenCalledTimes(1);
    expect(store!.getLatestRun(session.id)?.status).toBe("completed");
  });
});

describe("RunManager reconnect state", () => {
  it("adds an execution directive to continuation requests", async () => {
    const { project, provider, session, socket } = fixture();
    runtimeMocks.run.mockImplementation(
      async (request: { message: string }, onEvent: (event: BridgeEvent) => void) => {
        expect(request.message).toContain("这是一个继续执行请求");
        expect(request.message).toContain("不要只回复计划");
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "assistant.completed",
            payload: { itemId: "assistant-1", text: "已完成相关工作。" }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 2,
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
        message: "继续完成"
      },
      socket
    );
    expect(store?.getSession(session.id)?.status).toBe("idle");
    const message = store?.listMessages(session.id).find((item) => item.role === "user");
    expect(JSON.parse(message?.dataJson ?? "{}")).toMatchObject({ continuation: true });
  });

  it("uses configured continuation triggers and directive", async () => {
    const { project, provider, session, socket } = fixture();
    store?.updateSettings({
      continuationTriggers: ["继续我的工作"],
      continuationDirective: "请直接执行，不要只汇报计划。"
    });
    runtimeMocks.run.mockImplementation(
      async (request: { message: string }, onEvent: (event: BridgeEvent) => void) => {
        expect(request.message).toContain("请直接执行，不要只汇报计划。");
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
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "继续我的工作"
      },
      socket
    );
  });

  it("does not append a directive when the trigger list or directive is empty", async () => {
    const { project, provider, session, socket } = fixture();
    store?.updateSettings({ continuationTriggers: ["继续"], continuationDirective: "" });
    runtimeMocks.run.mockImplementation(
      async (request: { message: string }, onEvent: (event: BridgeEvent) => void) => {
        expect(request.message).toBe("继续");
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
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "继续"
      },
      socket
    );
  });

  it("does not append a continuation directive when continuation is disabled", async () => {
    const { project, provider, session, socket } = fixture();
    store?.updateSettings({ continuationEnabled: false });
    runtimeMocks.run.mockImplementation(
      async (request: { message: string }, onEvent: (event: BridgeEvent) => void) => {
        expect(request.message).toBe("继续");
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
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "继续"
      },
      socket
    );
  });

  it("automatically retries a continuation that only returns a plan", async () => {
    const { project, provider, session, socket, sent } = fixture();
    let calls = 0;
    runtimeMocks.run.mockImplementation(
      async (request: { message: string }, onEvent: (event: BridgeEvent) => void) => {
        calls += 1;
        if (calls === 1) {
          expect(request.message).toContain("这是一个继续执行请求");
          onEvent(
            bridgeEvent({
              seq: 1,
              type: "assistant.completed",
              payload: { itemId: "assistant-1", text: "我会先检查相关文件，然后继续处理。" }
            })
          );
        } else {
          expect(request.message).toContain("上一轮继续执行请求没有观察到工具调用");
          onEvent(
            bridgeEvent({
              seq: 1,
              type: "tool.started",
              payload: { itemId: "tool-1", tool: "read_file" }
            })
          );
        }
        onEvent(
          bridgeEvent({
            seq: 2,
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
        message: "继续"
      },
      socket
    );

    expect(calls).toBe(2);
    expect(
      sent.some((event) => event.type === "server.error" && event.payload?.kind === "retrying")
    ).toBe(true);
  });

  it("warns and stops after the automatic continuation retry has no execution evidence", async () => {
    const { project, provider, session, socket, sent } = fixture();
    let calls = 0;
    runtimeMocks.run.mockImplementation(
      async (_request: { message: string }, onEvent: (event: BridgeEvent) => void) => {
        calls += 1;
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "assistant.completed",
            payload: { itemId: `assistant-${calls}`, text: "我会继续处理。" }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 2,
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
        message: "继续"
      },
      socket
    );

    expect(calls).toBe(2);
    expect(store!.getSession(session.id)?.status).toBe("interrupted");
    expect(store!.listRuns({ sessionId: session.id }).map((run) => run.status)).toEqual([
      "interrupted",
      "interrupted"
    ]);
    expect(sent.some((event) => event.type === "turn.completed")).toBe(false);
    for (const run of store!.listRuns({ sessionId: session.id })) {
      const events = store!.listRunEvents(run.id).map((event) => JSON.parse(event.eventJson));
      expect(events.at(-1)).toMatchObject({
        type: "run.interrupted",
        payload: { completionGuard: { upstreamTerminal: "turn.completed" } }
      });
      expect(events.some((event) => event.type === "turn.completed")).toBe(false);
    }
    expect(
      sent.some((event) => event.type === "server.error" && event.payload?.kind === "warning")
    ).toBe(true);
  });

  it("retries a continuation even when Codex only emitted runtime_error warnings", async () => {
    const { project, provider, session, socket, sent } = fixture();
    let calls = 0;
    runtimeMocks.run.mockImplementation(
      async (request: { message: string }, onEvent: (event: BridgeEvent) => void) => {
        calls += 1;
        if (calls === 1) {
          onEvent(
            bridgeEvent({
              seq: 1,
              type: "tool.output",
              payload: {
                itemId: "err-1",
                tool: "runtime_error",
                message: "Model metadata for grok-4.6 not found. Defaulting to fallback metadata."
              }
            })
          );
          onEvent(
            bridgeEvent({
              seq: 2,
              type: "assistant.completed",
              payload: { itemId: "assistant-1", text: "我先检查相关文件，然后继续处理。" }
            })
          );
        } else {
          expect(request.message).toContain("没有观察到工具调用");
          onEvent(
            bridgeEvent({
              seq: 1,
              type: "tool.started",
              payload: { itemId: "tool-1", tool: "command" }
            })
          );
        }
        onEvent(
          bridgeEvent({
            seq: 9,
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
        message: "继续"
      },
      socket
    );

    expect(calls).toBe(2);
    expect(
      sent.some((event) => event.type === "server.error" && event.payload?.kind === "retrying")
    ).toBe(true);
  });

  it("retries after context compaction if the model only posts a short plan", async () => {
    const { project, provider, session, socket } = fixture();
    let calls = 0;
    runtimeMocks.run.mockImplementation(
      async (request: { message: string }, onEvent: (event: BridgeEvent) => void) => {
        calls += 1;
        if (calls === 1) {
          onEvent(
            bridgeEvent({
              seq: 1,
              type: "tool.started",
              payload: { itemId: "tool-1", tool: "command" }
            })
          );
          onEvent(
            bridgeEvent({
              seq: 2,
              type: "tool.output",
              payload: { itemId: "tool-1", tool: "command", output: "ok" }
            })
          );
          onEvent(
            bridgeEvent({
              seq: 3,
              type: "tool.output",
              payload: { itemId: "compact-1", tool: "context_compacted" }
            })
          );
          onEvent(
            bridgeEvent({
              seq: 4,
              type: "assistant.completed",
              payload: { itemId: "assistant-2", text: "先核对截图和审计页现状。" }
            })
          );
        } else {
          expect(request.message).toContain("压缩上下文");
          onEvent(
            bridgeEvent({
              seq: 1,
              type: "tool.started",
              payload: { itemId: "tool-2", tool: "command" }
            })
          );
        }
        onEvent(
          bridgeEvent({
            seq: 9,
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
        message: "grok-iq 审计页也显示用户原文"
      },
      socket
    );

    expect(calls).toBe(2);
    // Assert outside the runtime callback: startTurn catches runtime errors,
    // which otherwise also swallows failed assertions inside the mock.
    expect(runtimeMocks.run.mock.calls[1]?.[0].message).toContain("压缩上下文");
    expect(runtimeMocks.run.mock.calls[1]?.[0].message).toContain(
      "原始用户请求：\ngrok-iq 审计页也显示用户原文"
    );
    expect(store!.getLatestRun(session.id)?.status).toBe("completed");
  });

  it("recovers an initial plan-only turn while preserving the original request, thread and attachments", async () => {
    const { project, session, socket, sent, imagePath } = attachmentFixture();
    const message = "私库构建的时候报错了";
    const attachments = [{ name: "shot.png", path: imagePath, kind: "image" as const }];
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      const first = runtimeMocks.run.mock.calls.length === 1;
      onEvent(
        bridgeEvent({ seq: 1, type: "thread.started", payload: { threadId: "original-thread" } })
      );
      onEvent(
        bridgeEvent({
          seq: 2,
          type: "tool.output",
          payload: { tool: "runtime_error", message: "Model metadata missing" }
        })
      );
      onEvent(
        bridgeEvent(
          first
            ? {
                seq: 3,
                type: "assistant.completed",
                payload: {
                  itemId: "answer",
                  text: "先看你贴的构建报错图，再对照私库的 workflow 和最近合入的代码。"
                }
              }
            : {
                seq: 3,
                type: "tool.output",
                payload: { itemId: "read", tool: "command", output: "read workflow" }
              }
        )
      );
      onEvent(
        bridgeEvent({ seq: 4, type: "turn.completed", payload: { usage: { input_tokens: 10 } } })
      );
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        message,
        attachments,
        sandbox: "read-only",
        approvalPolicy: "on-request",
        networkAccessEnabled: false
      },
      socket
    );
    expect(runtimeMocks.run).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.run.mock.calls[1]?.[0]).toMatchObject({
      threadId: "original-thread",
      attachments,
      sandbox: "read-only",
      approvalPolicy: "on-request",
      networkAccessEnabled: false
    });
    expect(runtimeMocks.run.mock.calls[1]?.[0].message).toContain(`原始用户请求：\n${message}`);
    expect(sent.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    expect(store!.listRuns({ sessionId: session.id }).map((run) => run.status)).toEqual([
      "completed",
      "interrupted"
    ]);
  });

  it("does not call an unverified recovery completed or advance queued work", async () => {
    const { project, session, socket, sent } = fixture();
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      const text = runtimeMocks.run.mock.calls.length === 1 ? "我先检查截图。" : "已完成所有修改。";
      onEvent(
        bridgeEvent({ seq: 1, type: "assistant.completed", payload: { itemId: "answer", text } })
      );
      onEvent(
        bridgeEvent({ seq: 2, type: "tool.output", payload: { tool: "update_plan", items: [] } })
      );
      onEvent(bridgeEvent({ seq: 3, type: "turn.completed", payload: {} }));
    });
    store!.enqueueTurn({
      sessionId: session.id,
      projectId: project.id,
      message: "next queued task",
      optionsJson: "{}"
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      { type: "turn.start", projectId: project.id, sessionId: session.id, message: "继续" },
      socket
    );
    expect(runtimeMocks.run).toHaveBeenCalledTimes(2);
    expect(store!.getLatestRun(session.id)?.status).toBe("interrupted");
    expect(store!.listQueuedTurns(session.id)).toHaveLength(1);
    expect(sent.some((event) => event.type === "turn.completed")).toBe(false);
  });

  it.each(["plan", "disabled"] as const)("respects the %s recovery setting", async (mode) => {
    const { project, session, socket } = fixture();
    if (mode === "disabled") store!.updateSettings({ continuationEnabled: false });
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      onEvent(bridgeEvent({ seq: 1, type: "tool.output", payload: { tool: "context_compacted" } }));
      onEvent(
        bridgeEvent({
          seq: 2,
          type: "assistant.completed",
          payload: { itemId: "answer", text: "先核对截图和审计页现状。" }
        })
      );
      onEvent(bridgeEvent({ seq: 3, type: "turn.completed", payload: {} }));
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      {
        type: "turn.start",
        projectId: project.id,
        sessionId: session.id,
        message: "核对当前实现",
        ...(mode === "plan" ? { mode } : {})
      },
      socket
    );
    expect(runtimeMocks.run).toHaveBeenCalledTimes(1);
    expect(store!.getLatestRun(session.id)?.status).toBe(
      mode === "plan" ? "completed" : "interrupted"
    );
  });

  it("seeds a new fork from its copied history, then resumes only the new native thread", async () => {
    const { project, session, socket } = fixture();
    store!.updateSession(session.id, { threadId: "parent-thread" });
    store!.addMessage({
      sessionId: session.id,
      role: "user",
      content: "私库构建的时候报错了",
      providerId: null,
      eventType: "user.message",
      createdAt: 1,
      dataJson: JSON.stringify({ attachments: [{ path: ".codex-uploads/error.png" }] })
    });
    const branchPoint = store!.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "先看你贴的构建报错图。",
      providerId: null,
      eventType: "assistant.completed",
      createdAt: 2
    });
    store!.addMessage({
      sessionId: session.id,
      role: "user",
      content: "future message outside fork",
      providerId: null,
      eventType: "user.message",
      createdAt: 3
    });
    const fork = store!.forkSession(session.id, branchPoint.id)!;
    runtimeMocks.run.mockImplementation(async (_request, onEvent) => {
      onEvent(
        bridgeEvent({ seq: 1, type: "thread.started", payload: { threadId: "fork-thread" } })
      );
      onEvent(
        bridgeEvent({
          seq: 2,
          type: "assistant.completed",
          payload: { itemId: "answer", text: "已完成检查。" }
        })
      );
      onEvent(bridgeEvent({ seq: 3, type: "turn.completed", payload: {} }));
    });
    manager = new RunManager(store!, "/tmp/runtime");
    await manager.handle(
      { type: "turn.start", projectId: project.id, sessionId: fork.id, message: "继续" },
      socket
    );
    const first = runtimeMocks.run.mock.calls[0]?.[0];
    expect(first).not.toHaveProperty("threadId");
    expect(first.message).toContain("USER:\n私库构建的时候报错了");
    expect(first.message).toContain("ASSISTANT:\n先看你贴的构建报错图。");
    expect(first.message).toContain(".codex-uploads/error.png");
    expect(first.message).not.toContain("future message outside fork");
    await manager.handle(
      { type: "turn.start", projectId: project.id, sessionId: fork.id, message: "继续" },
      socket
    );
    expect(runtimeMocks.run).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.run.mock.calls[1]?.[0].threadId).toBe("fork-thread");
    expect(runtimeMocks.run.mock.calls[1]?.[0].message).not.toContain("fork-history");
    expect(store!.getSession(session.id)?.threadId).toBe("parent-thread");
  });

  it("forwards queued image attachments to the runtime", async () => {
    const { project, provider, session, socket, imagePath } = attachmentFixture();
    runtimeMocks.run.mockImplementation(
      async (request: { attachments?: unknown }, onEvent: (event: BridgeEvent) => void) => {
        expect(request.attachments).toEqual([{ name: "shot.png", path: imagePath, kind: "image" }]);
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
    await manager.handle(
      {
        type: "turn.enqueue",
        projectId: project.id,
        sessionId: session.id,
        providerId: provider.id,
        message: "see image",
        attachments: [{ name: "shot.png", path: ".codex-uploads/shot.png", kind: "image" }]
      },
      socket
    );

    expect(runtimeMocks.run).toHaveBeenCalled();
  });

  it("drops oversized stream events for a backed-up socket but keeps terminal events", async () => {
    const { project, provider, session, sent } = fixture();
    const socket = {
      readyState: 1,
      OPEN: 1,
      bufferedAmount: 3 * 1024 * 1024,
      send(data: string) {
        sent.push(JSON.parse(data));
      }
    };
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "assistant.delta",
            payload: { itemId: "answer-1", delta: "should be recovered from history" }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 2,
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

    expect(sent.some((event) => event.type === "assistant.delta")).toBe(false);
    expect(sent.some((event) => event.type === "turn.completed")).toBe(true);
  });

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

  it("does not replace a stream failure with the Codex exec stdin banner", async () => {
    const { project, provider, session, socket, sent } = fixture();
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "run.failed",
            payload: {
              status: "failed",
              message:
                "stream disconnected before completion: stream closed before response.completed"
            }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 2,
            type: "run.failed",
            payload: {
              status: "failed",
              message: "Codex Exec exited with code 1: Reading prompt from stdin...\n"
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
    ).toMatchObject([
      {
        content: "stream disconnected before completion: stream closed before response.completed"
      }
    ]);
    expect(store?.getLatestRun(session.id)?.reason).toBe(
      "stream disconnected before completion: stream closed before response.completed"
    );
  });

  it("uses the last reconnect reason when Codex exec only reports a stdin banner", async () => {
    const { project, provider, session, socket } = fixture();
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "run.reconnecting",
            payload: {
              status: "running",
              message:
                "Reconnecting... 4/5 (stream disconnected before completion: stream closed before response.completed)",
              attempt: 4,
              maxAttempts: 5,
              reason:
                "stream disconnected before completion: stream closed before response.completed"
            }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 2,
            type: "run.failed",
            payload: {
              status: "failed",
              message: "Codex Exec exited with code 1: Reading prompt from stdin...\n"
            }
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

    expect(store?.getSession(session.id)?.status).toBe("failed");
    expect(
      store?.listMessages(session.id).filter((message) => message.role === "error")[0]?.content
    ).toBe("stream disconnected before completion: stream closed before response.completed");
    expect(store?.getLatestRun(session.id)?.reason).toBe(
      "stream disconnected before completion: stream closed before response.completed"
    );
  });

  it("keeps provider errors instead of the Codex exec stdin banner", async () => {
    const { project, provider, session, socket } = fixture();
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "run.failed",
            payload: { status: "failed", message: "401 Unauthorized: invalid API key" }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 2,
            type: "run.failed",
            payload: {
              status: "failed",
              message: "Codex Exec exited with code 1: Reading prompt from stdin...\n"
            }
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

    expect(
      store?.listMessages(session.id).filter((message) => message.role === "error")[0]?.content
    ).toBe("401 Unauthorized: invalid API key");
    expect(store?.getLatestRun(session.id)?.reason).toBe("401 Unauthorized: invalid API key");
  });

  it("surfaces runtime_error items when Codex exec only reports a stdin banner", async () => {
    const { project, provider, session, socket } = fixture();
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "tool.output",
            payload: {
              itemId: "err-1",
              tool: "runtime_error",
              message: "model grok-4.6 does not exist",
              phase: "completed"
            }
          })
        );
        onEvent(
          bridgeEvent({
            seq: 2,
            type: "run.failed",
            payload: {
              status: "failed",
              message: "Codex Exec exited with code 1: Reading prompt from stdin...\n"
            }
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

    expect(
      store?.listMessages(session.id).filter((message) => message.role === "error")[0]?.content
    ).toBe("model grok-4.6 does not exist");
    expect(store?.getLatestRun(session.id)?.reason).toBe("model grok-4.6 does not exist");
  });

  it("recovers a runtime_error when the worker exits without run.failed", async () => {
    const { project, provider, session, socket } = fixture();
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "tool.output",
            payload: {
              itemId: "err-1",
              tool: "runtime_error",
              message: "model grok-4.6 does not exist",
              phase: "completed"
            }
          })
        );
        throw new Error("Codex Exec exited with code 1: Reading prompt from stdin...\n");
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

    expect(
      store?.listMessages(session.id).filter((message) => message.role === "error")[0]?.content
    ).toBe("model grok-4.6 does not exist");
    expect(store?.getLatestRun(session.id)?.reason).toBe("model grok-4.6 does not exist");
  });

  it("does not persist the Codex exec stdin banner when the worker exits uncleanly", async () => {
    const { project, provider, session, socket } = fixture();
    runtimeMocks.run.mockImplementation(async () => {
      throw new Error("Bridge worker exited with 1");
    });

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

    expect(
      store?.listMessages(session.id).filter((message) => message.role === "error")[0]?.content
    ).toBe("Codex 进程异常退出，未返回具体错误信息");
    expect(store?.getLatestRun(session.id)?.reason).toBe("Codex 进程异常退出，未返回具体错误信息");
  });
});

describe("RunManager steer inserts", () => {
  it("persists a steered user turn without replacing the current run cards", async () => {
    const { project, provider, session, socket, sent } = fixture();
    let release!: () => void;
    runtimeMocks.run.mockImplementation(
      async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
        onEvent(
          bridgeEvent({
            seq: 1,
            type: "assistant.completed",
            payload: { itemId: "m1", text: "先查北京。" }
          })
        );
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        onEvent(
          bridgeEvent({
            seq: 2,
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
        message: "明天北京的天气"
      },
      socket
    );
    await vi.waitFor(() => expect(runtimeMocks.run).toHaveBeenCalledTimes(1));
    await manager.handle(
      {
        type: "turn.steer",
        clientId: "steer-1",
        projectId: project.id,
        sessionId: session.id,
        message: "Runtime-only context: 还有西安的",
        displayMessage: "还有西安的"
      },
      socket
    );
    expect(runtimeMocks.steer).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.steer).toHaveBeenCalledWith(
      session.id,
      "Runtime-only context: 还有西安的",
      []
    );
    const users =
      store?.listMessages(session.id).filter((message) => message.role === "user") ?? [];
    expect(users.map((message) => message.content)).toEqual(["明天北京的天气", "还有西安的"]);
    const steered = users[1]!;
    expect(steered.itemId).toBe("steer:steer-1");
    expect(
      sent.find((event) => event.type === "user.message" && event.payload?.steer)
    ).toMatchObject({
      payload: {
        id: steered.id,
        itemId: "steer:steer-1",
        message: "还有西安的",
        steer: true
      }
    });
    expect(
      store?.listMessages(session.id).find((message) => message.role === "assistant")?.content
    ).toBe("先查北京。");
    release();
    await first;
  });
});

describe("RunManager recovery and queue", () => {
  it.each(["cancelled", "failed", "interrupted"] as const)(
    "replays a server-side %s event after all earlier progress",
    async (status) => {
      const { project, provider, session, socket, sent } = fixture();
      let release!: () => void;
      runtimeMocks.run.mockImplementation(
        async (_request: unknown, onEvent: (event: BridgeEvent) => void) => {
          onEvent(bridgeEvent({ seq: 1, type: "run.started", payload: {} }));
          onEvent(
            bridgeEvent({
              seq: 2,
              type: "tool.output",
              payload: { itemId: "tool-1", tool: "command", phase: "completed", output: "done" }
            })
          );
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      );
      manager = new RunManager(store!, "/tmp/runtime", status === "failed" ? 100 : 60_000);
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
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      manager.unsubscribeSocket(socket);
      if (status === "cancelled") manager.cancel(session.id);
      else if (status === "interrupted") manager.shutdown();
      await vi.waitFor(() => expect(store?.getLatestRun(session.id)?.status).toBe(status));
      release();
      await running;

      const run = store!.getLatestRun(session.id)!;
      const persisted = store!
        .listRunEvents(run.id, -1, 100)
        .map((row) => JSON.parse(row.eventJson));
      expect(persisted.at(-1)).toMatchObject({
        type: `run.${status}`,
        requestId: run.id,
        seq: 3,
        payload: { status }
      });
      sent.length = 0;
      await manager.handle(
        { type: "session.subscribe", sessionId: session.id, lastRequestId: run.id, lastSeq: 0 },
        socket
      );
      expect(sent[0]).toMatchObject({ type: "session.snapshot", payload: { run: { status } } });
      expect(sent.at(-1)).toMatchObject({ type: `run.${status}`, seq: 3 });
    }
  );

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
