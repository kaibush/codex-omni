import { afterEach, describe, expect, it } from "vitest";
import { Store, type MessageRow } from "./index.js";

let store: Store;
afterEach(() => store?.db.close());
function fixture(clientType: "codex" | "claude-code" = "codex") {
  store = new Store(":memory:");
  const provider = store.upsertProvider({ name: "Provider", kind: clientType });
  const project = store.createProject({
    name: "Project",
    displayPath: "/tmp",
    realPath: "/tmp",
    providerId: provider.id
  });
  const session = store.createSession({
    projectId: project.id,
    providerId: provider.id,
    clientType
  });
  store.updateSession(session.id, { threadId: "original-thread", model: "chosen-model" });
  const add = (role: MessageRow["role"], content: string, createdAt: number) =>
    store.addMessage({
      sessionId: session.id,
      role,
      content,
      createdAt,
      providerId: provider.id,
      eventType: null
    });
  const first = add("user", "KEEP_REQUEST", 1);
  const reply = add("assistant", "KEEP_REPLY", 2);
  const point = add("user", "REDO_REQUEST", 3);
  const tool = add("tool", "DISCARD_TOOL", 4);
  const future = add("assistant", "DISCARD_REPLY", 5);
  return { provider, project, session, first, reply, point, tool, future, add };
}

describe("session rewind", () => {
  for (const client of ["codex", "claude-code"] as const) {
    it(`forks before a user message without mutating the ${client} source`, () => {
      const { session, point } = fixture(client);
      const original = store.getSession(session.id);
      const messages = store.listMessages(session.id);
      const result = store.rewindSession(session.id, point.id, "fork");
      expect(result.session).toMatchObject({
        clientType: client,
        model: "chosen-model",
        threadId: null,
        parentSessionId: session.id,
        continuationMode: "fork"
      });
      expect(result.draft).toEqual(point);
      expect(result.backupSessionId).toBeNull();
      expect(store.listMessages(result.session.id).map((m) => m.content)).toEqual([
        "KEEP_REQUEST",
        "KEEP_REPLY"
      ]);
      expect(store.getSession(session.id)).toEqual(original);
      expect(store.listMessages(session.id)).toEqual(messages);
    });
  }

  it("backs up the complete timeline, stars, native thread and run replay before changing the current session", () => {
    const { session, project, point, future, add } = fixture();
    add("run", "OUTDATED_STATUS", 0);
    store.setMessageStarred(future.id, true);
    store.createRun({
      id: "previous-run",
      sessionId: session.id,
      projectId: project.id,
      serviceInstanceId: "test",
      cwd: "/tmp",
      startedAt: 1
    });
    store.updateRun("previous-run", { status: "completed" });
    store.appendRunEvent(
      "previous-run",
      session.id,
      1,
      JSON.stringify({
        type: "assistant.completed",
        sessionId: session.id,
        requestId: "previous-run",
        payload: { messageId: future.id }
      })
    );
    const original = store.listMessages(session.id);
    const result = store.rewindSession(session.id, point.id, "current");
    expect(result.session).toMatchObject({
      id: session.id,
      status: "idle",
      threadId: null,
      continuationMode: "rewind",
      lastMessageAt: 2
    });
    expect(store.listMessages(session.id).map((m) => m.content)).toEqual([
      "KEEP_REQUEST",
      "KEEP_REPLY"
    ]);
    expect(store.getLatestRun(session.id)).toBeUndefined();
    const backupId = result.backupSessionId!;
    expect(store.getSession(backupId)).toMatchObject({
      threadId: "original-thread",
      model: "chosen-model"
    });
    expect(store.listMessages(backupId).map((m) => [m.role, m.content, m.createdAt])).toEqual(
      original.map((m) => [m.role, m.content, m.createdAt])
    );
    const savedReply = store.listMessages(backupId).find((m) => m.content === future.content)!;
    expect(store.listSessionStars(backupId)).toEqual([savedReply.id]);
    expect(store.getLatestRun(backupId)).toMatchObject({ id: "previous-run", sessionId: backupId });
    expect(JSON.parse(store.listRunEvents("previous-run", -1, 10)[0]!.eventJson)).toMatchObject({
      sessionId: backupId,
      payload: { messageId: savedReply.id }
    });
    expect(store.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("retains the selected assistant reply and can rewind all the way to an empty conversation", () => {
    const { session, reply, first } = fixture();
    const branch = store.rewindSession(session.id, reply.id, "fork");
    expect(branch.draft).toBeNull();
    expect(store.listMessages(branch.session.id).map((m) => m.content)).toEqual([
      "KEEP_REQUEST",
      "KEEP_REPLY"
    ]);
    store.rewindSession(session.id, first.id, "current");
    expect(store.listMessages(session.id)).toEqual([]);
    expect(store.getSession(session.id)?.lastMessageAt).toBeNull();
  });

  it("keeps equal-timestamp message boundaries stable", () => {
    const { session } = fixture();
    store.db
      .prepare("UPDATE messages SET created_at=1,updated_at=1 WHERE session_id=?")
      .run(session.id);
    const all = store.listMessages(session.id);
    const point = all.findLast((m) => m.role === "user")!;
    const expected = all.slice(0, all.indexOf(point)).map((m) => m.id);
    const result = store.rewindSession(session.id, point.id, "current");
    expect(store.listMessages(session.id).map((m) => m.id)).toEqual(expected);
    expect(store.listMessages(result.backupSessionId!).map((m) => m.content)).toEqual(
      all.map((m) => m.content)
    );
  });

  it("rejects invalid anchors, terminal sessions, active runs and queued work without making a backup", () => {
    const { session, project, point, tool } = fixture();
    const foreign = store.createSession({ projectId: project.id });
    expect(() => store.rewindSession(foreign.id, point.id, "current")).toThrow("位置不存在");
    expect(() => store.rewindSession(session.id, tool.id, "current")).toThrow("用户消息或助手回复");
    const terminal = store.createSession({ projectId: project.id, kind: "terminal-chat" });
    expect(() => store.rewindSession(terminal.id, point.id, "fork")).toThrow("终端对话");
    store.createRun({
      id: "active",
      sessionId: session.id,
      projectId: project.id,
      serviceInstanceId: "other",
      cwd: "/tmp",
      startedAt: 1
    });
    expect(() => store.rewindSession(session.id, point.id, "current")).toThrow("先停止");
    store.updateRun("active", { status: "completed" });
    store.enqueueTurn({
      sessionId: session.id,
      projectId: project.id,
      message: "QUEUED",
      optionsJson: "{}"
    });
    expect(() => store.rewindSession(session.id, point.id, "current")).toThrow("队列");
    expect(store.listSessions(project.id)).toHaveLength(3);
    expect(store.listMessages(session.id)).toHaveLength(5);
    expect(store.getSession(session.id)?.threadId).toBe("original-thread");
  });

  it("rolls the entire operation back when persistence fails", () => {
    const { session, project, point } = fixture();
    const original = store.listMessages(session.id);
    store.db.exec(
      "CREATE TRIGGER reject_rewind BEFORE UPDATE ON sessions WHEN NEW.continuation_mode='rewind' BEGIN SELECT RAISE(ABORT,'fixture failure'); END"
    );
    expect(() => store.rewindSession(session.id, point.id, "current")).toThrow("fixture failure");
    expect(store.listSessions(project.id)).toHaveLength(1);
    expect(store.listMessages(session.id)).toEqual(original);
    expect(store.getSession(session.id)?.threadId).toBe("original-thread");
  });

  it("does not retain an assistant message that streamed across the chosen user boundary", () => {
    const { session, reply, point } = fixture();
    store.db
      .prepare("UPDATE messages SET content='LATER_STEERING_REPLY',updated_at=4 WHERE id=?")
      .run(reply.id);
    for (const mode of ["fork", "current"] as const) {
      const result = store.rewindSession(session.id, point.id, mode);
      expect(store.listMessages(result.session.id).map((m) => m.content)).toEqual(["KEEP_REQUEST"]);
    }
  });
});
