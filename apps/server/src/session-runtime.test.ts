import { afterEach, describe, expect, it } from "vitest";
import { Store } from "@codex-omni/db";
import {
  runtimeHistoryContext,
  saveRuntimeCursor,
  selectSessionProvider,
  switchSessionProvider
} from "./session-runtime.js";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
});
function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  const codex = store.upsertProvider({ name: "Codex A", kind: "codex", isDefault: 1 });
  const claude = store.upsertProvider({ name: "Claude B", kind: "claude-code", isDefault: 1 });
  const other = store.upsertProvider({ name: "Codex C", kind: "codex" });
  const project = store.createProject({
    name: "Demo",
    displayPath: "/tmp/demo",
    realPath: "/tmp/demo",
    providerId: codex.id
  });
  const session = store.createSession({ projectId: project.id, providerId: codex.id });
  return { store, codex, claude, other, project, session };
}

describe("multi-client sessions", () => {
  it("keeps separate defaults and chooses a provider matching the requested client", () => {
    const { store, codex, claude, other, project } = fixture();
    expect(store.getProvider(codex.id)?.isDefault).toBe(1);
    expect(store.getProvider(claude.id)?.isDefault).toBe(1);
    expect(
      selectSessionProvider(store, { projectId: project.id, clientType: "claude-code" })
    ).toEqual({ clientType: "claude-code", providerId: claude.id });
    expect(() =>
      selectSessionProvider(store, {
        projectId: project.id,
        clientType: "claude-code",
        providerId: codex.id
      })
    ).toThrow("不匹配");
    store.upsertProvider({ ...other, isDefault: 1 });
    expect(store.getProvider(codex.id)?.isDefault).toBe(0);
    expect(store.getProvider(claude.id)?.isDefault).toBe(1);
  });

  it("switches in place, restores each thread, and only transfers messages that thread has not seen", () => {
    const { store, codex, claude, other, session, project } = fixture();
    store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "Implement the parser",
      providerId: codex.id,
      eventType: null
    });
    store.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "Parser implemented",
      providerId: codex.id,
      eventType: null
    });
    store.updateSession(session.id, { threadId: "codex-thread" });
    saveRuntimeCursor(store, session.id);
    const oldCursor = store.getSessionRuntimeBinding(session.id, codex.id)!;
    const switched = switchSessionProvider(store, session.id, claude.id);
    expect(switched).toMatchObject({
      id: session.id,
      clientType: "claude-code",
      providerId: claude.id,
      threadId: null
    });
    expect(runtimeHistoryContext(store, session.id, claude.id)).toContain("Implement the parser");
    const user = store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "Also test it",
      providerId: claude.id,
      eventType: null
    });
    const assistant = store.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "Tests pass",
      providerId: claude.id,
      eventType: null
    });
    store.db
      .prepare("UPDATE messages SET created_at=? WHERE id IN (?,?)")
      .run(oldCursor.lastMessageAt! + 10, user.id, assistant.id);
    store.updateSession(session.id, { threadId: "claude-thread" });
    saveRuntimeCursor(store, session.id);
    const back = switchSessionProvider(store, session.id, codex.id);
    expect(back.threadId).toBe("codex-thread");
    const context = runtimeHistoryContext(store, session.id, codex.id)!;
    expect(context).toContain("Tests pass");
    expect(context).not.toContain("Parser implemented");
    expect(store.listSessions(project.id)).toHaveLength(1);
    expect(store.conversationSince(session.id)).toHaveLength(4);
    const newProvider = switchSessionProvider(store, session.id, other.id);
    expect(newProvider.threadId).toBeNull();
    expect(runtimeHistoryContext(store, session.id, other.id)).toContain("Implement the parser");
    expect(switchSessionProvider(store, session.id, claude.id).threadId).toBe("claude-thread");
    switchSessionProvider(store, session.id, codex.id);
    expect(runtimeHistoryContext(store, session.id, codex.id)).toContain("Tests pass");
  });

  it("blocks switching while work or queued input still belongs to the old provider", () => {
    const { store, claude, session, project } = fixture();
    store.updateSession(session.id, { status: "running" });
    expect(() => switchSessionProvider(store, session.id, claude.id)).toThrow("任务结束");
    store.updateSession(session.id, { status: "idle" });
    store.enqueueTurn({
      sessionId: session.id,
      projectId: project.id,
      message: "pending",
      optionsJson: "{}"
    });
    expect(() => switchSessionProvider(store, session.id, claude.id)).toThrow("队列");
  });

  it("uses insertion order for history cursors when all messages share a timestamp", () => {
    const { store, codex, claude, session } = fixture();
    store.addMessage({
      sessionId: session.id,
      providerId: codex.id,
      role: "user",
      content: "Before",
      eventType: null,
      createdAt: 42
    });
    store.updateSession(session.id, { threadId: "native" });
    saveRuntimeCursor(store, session.id);
    switchSessionProvider(store, session.id, claude.id);
    store.addMessage({
      sessionId: session.id,
      providerId: claude.id,
      role: "assistant",
      content: "After",
      eventType: null,
      createdAt: 42
    });
    switchSessionProvider(store, session.id, codex.id);
    expect(runtimeHistoryContext(store, session.id, codex.id)).toContain("After");
    expect(runtimeHistoryContext(store, session.id, codex.id)).not.toContain("Before");
  });

  it("forks retain their client and start with portable history instead of a native thread", () => {
    const { store, claude, project } = fixture();
    const source = store.createSession({ projectId: project.id, providerId: claude.id });
    store.addMessage({
      sessionId: source.id,
      role: "user",
      content: "Review",
      providerId: claude.id,
      eventType: null
    });
    store.updateSession(source.id, { threadId: "claude-original" });
    const fork = store.forkSession(source.id)!;
    expect(fork).toMatchObject({ clientType: "claude-code", threadId: null });
    expect(runtimeHistoryContext(store, fork.id, claude.id)).toContain("Review");
  });
});
