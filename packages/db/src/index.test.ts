import { afterEach, describe, expect, it } from "vitest";
import { Store } from "./index.js";
let store: Store | undefined;
afterEach(() => store?.db.close());
describe("Store", () => {
  it("creates provider, project and continuation session", () => {
    store = new Store(":memory:");
    const provider = store.upsertProvider({ name: "Provider A" });
    const project = store.createProject({
      name: "Project",
      displayPath: "/tmp",
      realPath: "/tmp",
      providerId: provider.id
    });
    const source = store.createSession({ projectId: project.id, providerId: provider.id });
    const target = store.createSession({
      projectId: project.id,
      providerId: provider.id,
      parentSessionId: source.id,
      continuationMode: "portable-context"
    });
    expect(target.parentSessionId).toBe(source.id);
  });
  it("renames, pins and sorts projects by last opened", () => {
    store = new Store(":memory:");
    const first = store.createProject({ name: "Alpha", displayPath: "/tmp/a", realPath: "/tmp/a" });
    const second = store.createProject({
      name: "Beta",
      displayPath: "/tmp/b",
      realPath: "/tmp/b"
    });
    store.updateProject(first.id, { lastOpenedAt: 10 });
    store.updateProject(second.id, { lastOpenedAt: 20, name: "Beta Lab" });
    expect(store.listProjects().map((item) => item.name)).toEqual(["Beta Lab", "Alpha"]);
    store.updateProject(first.id, { pinnedAt: 30 });
    expect(store.listProjects()[0]?.id).toBe(first.id);
  });
  it("looks up a message by item id", () => {
    store = new Store(":memory:");
    const project = store.createProject({ name: "P", displayPath: "/tmp", realPath: "/tmp" });
    const session = store.createSession({ projectId: project.id });
    store.upsertEventMessage({
      sessionId: session.id,
      role: "assistant",
      content: "hello",
      eventType: "assistant.delta",
      itemId: "req:item"
    });
    expect(store.getMessageByItemId(session.id, "req:item")?.content).toBe("hello");
    const byItem = store.getMessageByItemId(session.id, "req:item");
    expect(byItem && store.getMessage(byItem.id)?.content).toBe("hello");
  });
  it("manages one default provider and persistent settings", () => {
    store = new Store(":memory:");
    const first = store.upsertProvider({ name: "Provider A", isDefault: 1 });
    const second = store.upsertProvider({ name: "Provider B", isDefault: 1 });
    expect(store.getProvider(first.id)?.isDefault).toBe(0);
    expect(store.getProvider(second.id)?.isDefault).toBe(1);
    store.updateSettings({ sandbox: "read-only", showReasoning: false });
    expect(store.getSettings({ sandbox: "workspace-write", showReasoning: true })).toEqual({
      sandbox: "read-only",
      showReasoning: false
    });
    expect(store.deleteProvider(second.id)).toBe(true);
    expect(store.getProvider(first.id)?.isDefault).toBe(1);
  });
  it("stores provider home mode and existing CODEX_HOME path", () => {
    store = new Store(":memory:");
    const managed = store.upsertProvider({ name: "Managed" });
    expect(managed.homeMode).toBe("managed");
    const external = store.upsertProvider({
      name: "External",
      homeMode: "external",
      codexHomePath: "/tmp/existing-codex"
    });
    expect(store.getProvider(external.id)?.homeMode).toBe("external");
    expect(store.getProvider(external.id)?.codexHomePath).toBe("/tmp/existing-codex");
  });
  it("stores an independent model catalog for each provider", () => {
    store = new Store(":memory:");
    const first = store.upsertProvider({
      name: "Provider A",
      model: "model-a",
      modelsJson: JSON.stringify(["model-a", "model-a-fast"])
    });
    const second = store.upsertProvider({
      name: "Provider B",
      model: "model-b",
      modelsJson: JSON.stringify(["model-b"])
    });
    expect(JSON.parse(store.getProvider(first.id)?.modelsJson ?? "[]")).toEqual([
      "model-a",
      "model-a-fast"
    ]);
    expect(JSON.parse(store.getProvider(second.id)?.modelsJson ?? "[]")).toEqual(["model-b"]);
  });
  it("deletes the only provider and leaves no default reference", () => {
    store = new Store(":memory:");
    const provider = store.upsertProvider({ name: "Only Provider", isDefault: 1 });
    expect(store.deleteProvider(provider.id)).toBe(true);
    expect(store.listProviders()).toEqual([]);
  });
  it("updates a thread without requiring a status parameter", () => {
    store = new Store(":memory:");
    const db = store;
    const project = db.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const session = db.createSession({ projectId: project.id });
    expect(() => db.updateSession(session.id, { threadId: "thread-1" })).not.toThrow();
    expect(db.getSession(session.id)?.threadId).toBe("thread-1");
  });
  it("marks sessions interrupted by a server restart", () => {
    store = new Store(":memory:");
    const db = store;
    const project = db.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const session = db.createSession({ projectId: project.id });
    db.updateSession(session.id, { status: "running" });
    expect(db.resetInterruptedSessions()).toBe(1);
    expect(db.getSession(session.id)?.status).toBe("interrupted");
    expect(db.listMessages(session.id)[0]).toMatchObject({
      role: "run",
      eventType: "run.interrupted"
    });
  });
  it("upserts streamed tool events and preserves structured data", () => {
    store = new Store(":memory:");
    const db = store;
    const project = db.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const session = db.createSession({ projectId: project.id });
    db.upsertEventMessage({
      sessionId: session.id,
      role: "tool",
      content: "started",
      eventType: "tool.started",
      itemId: "request-1:tool-1",
      dataJson: JSON.stringify({ status: "running" })
    });
    db.upsertEventMessage({
      sessionId: session.id,
      role: "tool",
      content: "done",
      eventType: "tool.output",
      itemId: "request-1:tool-1",
      dataJson: JSON.stringify({ status: "completed" })
    });
    const messages = db.listMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "tool",
      content: "done",
      eventType: "tool.output",
      itemId: "request-1:tool-1"
    });
    db.upsertEventMessage({
      sessionId: session.id,
      role: "tool",
      content: "next turn",
      eventType: "tool.output",
      itemId: "request-2:tool-1"
    });
    expect(db.listMessages(session.id)).toHaveLength(2);
    db.upsertEventMessage({
      sessionId: session.id,
      role: "tool",
      content: "spawned",
      eventType: "tool.output",
      itemId: "jsonl:call-spawn",
      createdAt: 1_788_070_945_680
    });
    expect(db.getMessageByItemId(session.id, "jsonl:call-spawn")?.createdAt).toBe(1_788_070_945_680);
  });

  it("pages backward through messages without gaps when timestamps match", () => {
    store = new Store(":memory:");
    const project = store.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const session = store.createSession({ projectId: project.id });
    for (const content of ["one", "two", "three", "four", "five"]) {
      store.addMessage({
        sessionId: session.id,
        role: "user",
        content,
        providerId: null,
        eventType: "user.message"
      });
    }
    store.db
      .prepare("UPDATE messages SET created_at=1000,updated_at=1000 WHERE session_id=?")
      .run(session.id);
    const all = store.listMessages(session.id);
    const first = store.listMessagePage(session.id, { limit: 2 });
    const second = store.listMessagePage(session.id, {
      limit: 2,
      before: first.nextCursor!
    });
    const third = store.listMessagePage(session.id, {
      limit: 2,
      before: second.nextCursor!
    });
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(true);
    expect(third.hasMore).toBe(false);
    expect(
      [...third.messages, ...second.messages, ...first.messages].map((message) => message.id)
    ).toEqual(all.map((message) => message.id));
  });

  it("deletes a session and names it from the first user message", () => {
    store = new Store(":memory:");
    const project = store.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const session = store.createSession({ projectId: project.id });
    expect(session.title).toBe("新对话");
    store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "帮我看看登录页面。然后再改 websocket",
      providerId: null,
      eventType: "user.message"
    });
    expect(store.getSession(session.id)?.title).toBe("帮我看看登录页面");
    expect(store.deleteSession(session.id)).toBe(true);
    expect(store.getSession(session.id)).toBeUndefined();
    expect(store.listSessions(project.id)).toEqual([]);
  });

  it("deletes a project and cascades sessions and messages", () => {
    store = new Store(":memory:");
    const project = store.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const other = store.createProject({
      name: "Other",
      displayPath: "/tmp/other",
      realPath: "/tmp/other"
    });
    const session = store.createSession({ projectId: project.id });
    const continued = store.createSession({
      projectId: project.id,
      parentSessionId: session.id,
      continuationMode: "portable-context"
    });
    store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "hello",
      providerId: null,
      eventType: "user.message"
    });
    const kept = store.createSession({
      projectId: other.id,
      parentSessionId: session.id
    });
    expect(store.deleteProject(project.id)).toBe(true);
    expect(store.getProject(project.id)).toBeUndefined();
    expect(store.getSession(session.id)).toBeUndefined();
    expect(store.getSession(continued.id)).toBeUndefined();
    expect(store.listMessages(session.id)).toEqual([]);
    expect(store.getProject(other.id)?.id).toBe(other.id);
    expect(store.getSession(kept.id)).toMatchObject({ id: kept.id, parentSessionId: null });
    expect(store.deleteProject("missing")).toBe(false);
  });

  it("lists newest sessions first", () => {
    store = new Store(":memory:");
    const project = store.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const older = store.createSession({ projectId: project.id, title: "旧对话" });
    const newer = store.createSession({ projectId: project.id, title: "新对话" });
    store.db
      .prepare("UPDATE sessions SET created_at=1, updated_at=1, last_message_at=NULL WHERE id=?")
      .run(older.id);
    store.db
      .prepare("UPDATE sessions SET created_at=2, updated_at=3, last_message_at=NULL WHERE id=?")
      .run(newer.id);
    expect(store.listSessions(project.id).map((session) => session.id)).toEqual([
      newer.id,
      older.id
    ]);
  });

  it("searches, pins, archives and restores sessions", () => {
    store = new Store(":memory:");
    const project = store.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const alpha = store.createSession({ projectId: project.id, title: "Alpha session" });
    const beta = store.createSession({ projectId: project.id, title: "Beta session" });
    store.addMessage({
      sessionId: beta.id,
      role: "assistant",
      content: "unique websocket answer",
      providerId: null,
      eventType: "assistant.completed"
    });
    expect(store.listSessions(project.id, { query: "websocket" }).map((item) => item.id)).toEqual([
      beta.id
    ]);
    store.updateSession(alpha.id, { pinnedAt: 100 });
    expect(store.listSessions(project.id)[0]?.id).toBe(alpha.id);
    store.updateSession(alpha.id, { archivedAt: 200 });
    expect(store.listSessions(project.id).some((item) => item.id === alpha.id)).toBe(false);
    expect(
      store.listSessions(project.id, { includeArchived: true }).find((item) => item.id === alpha.id)
        ?.archivedAt
    ).toBe(200);
    store.updateSession(alpha.id, { archivedAt: null });
    expect(store.listSessions(project.id).some((item) => item.id === alpha.id)).toBe(true);
    store.updateSession(alpha.id, {
      color: "sky",
      icon: "bug",
      tagsJson: JSON.stringify(["frontend"])
    });
    const decorated = store.getSession(alpha.id);
    expect(decorated?.color).toBe("sky");
    expect(decorated?.icon).toBe("bug");
    expect(decorated?.tags).toEqual(["frontend"]);
    const message = store.addMessage({
      sessionId: alpha.id,
      role: "user",
      content: "keep this",
      providerId: null,
      eventType: "user"
    });
    expect(store.setMessageStarred(message.id, true)?.starred).toBe(true);
    expect(store.listSessionStars(alpha.id)).toEqual([message.id]);
    store.setMessageStarred(message.id, false);
    expect(store.listSessionStars(alpha.id)).toEqual([]);
  });

  it("indexes messages for full-text search", () => {
    store = new Store(":memory:");
    const project = store.createProject({
      name: "Search Project",
      displayPath: "/tmp",
      realPath: "/tmp/search"
    });
    const session = store.createSession({ projectId: project.id, title: "Palette session" });
    store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "please inspect the websocket reconnect path",
      providerId: null,
      eventType: "user"
    });
    store.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "the reconnect uses requestId plus seq",
      providerId: null,
      eventType: "assistant.completed"
    });
    expect(store.searchSessions("Palette").map((item) => item.id)).toEqual([session.id]);
    const hits = store.searchMessages("websocket reconnect");
    expect(hits[0]?.sessionId).toBe(session.id);
    expect(hits[0]?.snippet.toLowerCase()).toContain("websocket");
    store.upsertEventMessage({
      sessionId: session.id,
      role: "assistant",
      content: "updated answer about snapshot replay",
      providerId: null,
      eventType: "assistant.completed",
      itemId: "assistant-1"
    });
    expect(store.searchMessages("snapshot replay")[0]?.snippet).toContain("snapshot");
  });

  it("persists run replay, approvals and ordered queued turns", () => {
    store = new Store(":memory:");
    const provider = store.upsertProvider({ name: "Provider" });
    const project = store.createProject({
      name: "Project",
      displayPath: "/tmp",
      realPath: "/tmp",
      providerId: provider.id
    });
    const session = store.createSession({ projectId: project.id, providerId: provider.id });
    const run = store.createRun({
      id: "run-1",
      sessionId: session.id,
      projectId: project.id,
      providerId: provider.id,
      serviceInstanceId: "server-1",
      cwd: "/tmp",
      startedAt: 10
    });
    store.appendRunEvent(run.id, session.id, 0, JSON.stringify({ type: "run.started", seq: 0 }));
    store.appendRunEvent(
      run.id,
      session.id,
      1,
      JSON.stringify({ type: "assistant.delta", seq: 1 })
    );
    expect(store.listRunEvents(run.id, 0)).toEqual([
      expect.objectContaining({ seq: 1, eventJson: expect.stringContaining("assistant.delta") })
    ]);
    store.upsertApproval({
      id: "approval-1",
      runId: run.id,
      sessionId: session.id,
      tool: "command",
      command: "pnpm test"
    });
    expect(store.listPendingApprovals(session.id)).toHaveLength(1);
    expect(store.resolveApproval("approval-1", "accepted", "accept")?.status).toBe("accepted");
    const first = store.enqueueTurn({
      id: "client-1",
      sessionId: session.id,
      projectId: project.id,
      providerId: provider.id,
      message: "first",
      optionsJson: "{}"
    });
    const duplicate = store.enqueueTurn({
      id: "client-1",
      sessionId: session.id,
      projectId: project.id,
      providerId: provider.id,
      message: "duplicate",
      optionsJson: "{}"
    });
    const second = store.enqueueTurn({
      sessionId: session.id,
      projectId: project.id,
      providerId: provider.id,
      message: "second",
      optionsJson: "{}"
    });
    expect(duplicate.id).toBe(first.id);
    expect(new Set(store.listQueuedTurns(session.id).map((item) => item.id))).toEqual(
      new Set([first.id, second.id])
    );
    expect(store.updateQueuedTurn(second.id, "updated")?.message).toBe("updated");
    const third = store.enqueueTurn({
      sessionId: session.id,
      projectId: project.id,
      providerId: provider.id,
      message: "third",
      optionsJson: "{}"
    });
    expect(store.listQueuedTurns(session.id).map((item) => item.message)).toEqual([
      "duplicate",
      "updated",
      "third"
    ]);
    expect(store.moveQueuedTurn(session.id, third.id, "up").map((item) => item.message)).toEqual([
      "duplicate",
      "third",
      "updated"
    ]);
    expect(store.moveQueuedTurn(session.id, first.id, "up").map((item) => item.message)).toEqual([
      "duplicate",
      "third",
      "updated"
    ]);
    expect(store.deleteQueuedTurn(first.id)).toBe(true);
  });
  it("stores prompt templates, tasks and checkpoints", () => {
    store = new Store(":memory:");
    const project = store.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const session = store.createSession({ projectId: project.id });
    const template = store.upsertPromptTemplate({
      name: "审查",
      command: "/review-extra",
      content: "请审查"
    });
    expect(store.listPromptTemplates()).toEqual([expect.objectContaining({ id: template.id })]);
    const task = store.upsertTask({
      projectId: project.id,
      sessionId: session.id,
      title: "修分页"
    });
    expect(store.getTask(task.id)?.status).toBe("todo");
    store.upsertTask({
      id: task.id,
      projectId: project.id,
      title: "修分页",
      status: "doing",
      sessionId: session.id
    });
    expect(store.listTasks(project.id)[0]?.status).toBe("doing");
    const checkpoint = store.addCheckpoint({
      sessionId: session.id,
      projectId: project.id,
      title: "执行前检查点",
      gitHead: "abc123",
      patch: "diff --git a/a b/a"
    });
    expect(store.listCheckpoints(session.id)[0]?.id).toBe(checkpoint.id);
    expect(store.deleteTask(task.id)).toBe(true);
    expect(store.deletePromptTemplate(template.id)).toBe(true);
  });

  it("stores project notes, operations and scheduled jobs", () => {
    store = new Store(":memory:");
    const project = store.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const note = store.upsertProjectNote({
      projectId: project.id,
      kind: "rule",
      title: "测试约定",
      content: "先跑测试再提交"
    });
    expect(store.listProjectNotes(project.id)[0]?.title).toBe("测试约定");
    store.upsertProjectNote({
      id: note.id,
      projectId: project.id,
      title: "测试约定",
      content: "先跑测试再提交",
      enabled: false
    });
    expect(store.getProjectNote(note.id)?.enabled).toBe(0);
    const event = store.addOperationEvent({
      projectId: project.id,
      kind: "git.discard",
      title: "丢弃 src/a.ts",
      undoJson: JSON.stringify({ type: "git-checkpoint", head: "abc" })
    });
    expect(store.listOperationEvents(project.id)[0]?.id).toBe(event.id);
    const job = store.upsertScheduledJob({
      projectId: project.id,
      title: "每日测试",
      prompt: "请运行测试并汇报结果",
      cadence: "daily",
      dailyAt: "09:00",
      nextRunAt: Date.now() - 1000
    });
    expect(store.dueScheduledJobs()[0]?.id).toBe(job.id);
    expect(store.deleteProjectNote(note.id)).toBe(true);
    expect(store.deleteScheduledJob(job.id)).toBe(true);
  });

  it("filters sessions by status and returns search snippets", () => {
    store = new Store(":memory:");
    const project = store.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const idle = store.createSession({ projectId: project.id, title: "Idle notes" });
    const running = store.createSession({ projectId: project.id, title: "Running notes" });
    store.updateSession(running.id, { status: "running" });
    store.addMessage({
      sessionId: idle.id,
      role: "user",
      content: "please inspect websocket snapshot replay",
      providerId: null,
      eventType: "user.message"
    });
    expect(store.listSessions(project.id, { status: "running" }).map((item) => item.id)).toEqual([
      running.id
    ]);
    const hits = store.searchSessions("websocket", { status: "idle" });
    expect(hits.map((item) => item.id)).toEqual([idle.id]);
    expect(hits[0]?.snippet.toLowerCase()).toContain("websocket");
  });

  it("lists approval history, forks a session and clears run records", () => {
    store = new Store(":memory:");
    const project = store.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const session = store.createSession({ projectId: project.id, title: "Audit session" });
    const user = store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "run tests",
      providerId: null,
      eventType: "user.message"
    });
    const assistant = store.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "I will run tests",
      providerId: null,
      eventType: "assistant.completed"
    });
    store.db.prepare("UPDATE messages SET created_at=1, updated_at=1 WHERE id=?").run(user.id);
    store.db.prepare("UPDATE messages SET created_at=2, updated_at=2 WHERE id=?").run(assistant.id);
    store.addMessage({
      sessionId: session.id,
      role: "tool",
      content: "pnpm test output",
      providerId: null,
      eventType: "tool.output",
      itemId: "tool-1"
    });
    store.createRun({
      id: "run-1",
      sessionId: session.id,
      projectId: project.id,
      serviceInstanceId: "svc",
      cwd: "/tmp",
      startedAt: Date.now()
    });
    store.updateRun("run-1", { status: "completed" });
    store.appendRunEvent("run-1", session.id, 1, "{}");
    store.upsertApproval({
      id: "approval-1",
      runId: "run-1",
      sessionId: session.id,
      tool: "command",
      command: "pnpm test"
    });
    store.resolveApproval("approval-1", "accepted", "accept");
    expect(store.listApprovals({ projectId: project.id })[0]).toMatchObject({
      id: "approval-1",
      status: "accepted",
      projectName: "Project",
      sessionTitle: "Audit session"
    });
    expect(store.approvalStats({ projectId: project.id })).toMatchObject({
      total: 1,
      accepted: 1,
      pending: 0
    });
    const forked = store.forkSession(session.id, user.id);
    expect(forked?.continuationMode).toBe("fork");
    expect(store.listMessages(forked!.id).map((item) => item.role)).toEqual(["user"]);
    store.clearSessionRunRecords(session.id);
    expect(store.listMessages(session.id).map((item) => item.role)).toEqual(["user", "assistant"]);
    expect(store.listRuns({ sessionId: session.id })).toEqual([]);
  });
});
