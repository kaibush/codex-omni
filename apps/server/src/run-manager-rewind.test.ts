import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "@codex-omni/db";
import { RunManager } from "./run-manager.js";

const native = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("@codex-omni/codex-runtime", async (original) => ({
  ...(await original<typeof import("@codex-omni/codex-runtime")>()),
  withNativeRewind: native.prepare
}));
let store: Store;
let manager: RunManager;
beforeEach(() => {
  native.prepare.mockReset();
});
afterEach(() => {
  manager?.shutdown();
  store?.db.close();
});
function fixture() {
  store = new Store(":memory:");
  const provider = store.upsertProvider({ name: "Fixture" });
  const project = store.createProject({
    name: "Fixture",
    displayPath: "/tmp",
    realPath: "/tmp",
    providerId: provider.id
  });
  const session = store.createSession({ projectId: project.id, providerId: provider.id });
  store.updateSession(session.id, { threadId: "original" });
  const point = store.addMessage({
    sessionId: session.id,
    role: "user",
    content: "request",
    providerId: provider.id,
    eventType: "user.message"
  });
  manager = new RunManager(store, "/tmp/omni-rewind-lock-fixture");
  let finish!: () => void;
  native.prepare.mockImplementation(async (_request, _messages, _messageId, commit) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return commit("native-prefix");
  });
  return { project, session, point, finish: () => finish() };
}

describe("rewind concurrency", () => {
  it("blocks a second rewind and sending until native preparation commits", async () => {
    const { session, project, point, finish } = fixture();
    const pending = manager.rewindSession(session.id, point.id, "current", { backup: true });
    await expect(manager.rewindSession(session.id, point.id, "current")).rejects.toThrow(
      "正在回退"
    );
    const sent: string[] = [];
    await expect(
      manager.handle(
        {
          type: "turn.start",
          projectId: project.id,
          sessionId: session.id,
          message: "should not start"
        },
        { readyState: 1, OPEN: 1, send: (data) => sent.push(data) }
      )
    ).rejects.toThrow("正在回退");
    expect(store.listRuns({ sessionId: session.id })).toHaveLength(0);
    finish();
    const result = await pending;
    expect(result.session.threadId).toBe("native-prefix");
    expect(store.getSession(result.backupSessionId!)?.threadId).toBe("original");
  });

  it("refuses a stale native prefix if another writer changes the conversation", async () => {
    const { session, project, point, finish } = fixture();
    const pending = manager.rewindSession(session.id, point.id, "current");
    store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "concurrent request",
      providerId: session.providerId,
      eventType: "user.message"
    });
    finish();
    await expect(pending).rejects.toThrow("对话已变更");
    expect(store.getSession(session.id)?.threadId).toBe("original");
    expect(store.listMessages(session.id)).toHaveLength(2);
    expect(store.listSessions(project.id)).toHaveLength(1);
  });

  it("does not silently fall back to a text snapshot when the native service fails", async () => {
    const { session, point } = fixture();
    native.prepare.mockRejectedValue(new Error("Native history unavailable"));
    await expect(manager.rewindSession(session.id, point.id, "current")).rejects.toThrow(
      "Native history unavailable"
    );
    expect(store.getSession(session.id)?.threadId).toBe("original");
    expect(store.listMessages(session.id)).toHaveLength(1);
  });
});
