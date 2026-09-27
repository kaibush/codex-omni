import { afterEach, describe, expect, it } from "vitest";
import { Store } from "@codex-omni/db";
import {
  runtimeHistoryContext,
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
  const switchTo = (id: string) => switchSessionProvider(store, session.id, id);
  return { store, codex, claude, other, project, session, switchTo };
}

describe("sessions with a fixed client", () => {
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

  it("switches only this session's provider while preserving its native thread", () => {
    const { store, codex, other, session, project, switchTo } = fixture();
    const second = store.createSession({ projectId: project.id, providerId: codex.id });
    store.updateSession(session.id, { threadId: "native-thread" });
    store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "Implement the parser",
      providerId: codex.id,
      eventType: null
    });
    expect(switchTo(other.id)).toMatchObject({
      id: session.id,
      clientType: "codex",
      providerId: other.id,
      threadId: "native-thread"
    });
    expect(runtimeHistoryContext(store, session.id, other.id)).toBeNull();
    expect(switchTo(codex.id).threadId).toBe("native-thread");
    expect(store.getSession(second.id)?.providerId).toBe(codex.id);
    expect(store.listSessions(project.id)).toHaveLength(2);
    expect(store.conversationSince(session.id)).toHaveLength(1);
  });

  it("rejects cross-client switches and continuations without changing sessions or history", () => {
    const { store, claude, session, project, switchTo } = fixture();
    const before = store.getSession(session.id);
    expect(() => switchTo(claude.id)).toThrow("对话客户端不能更换");
    expect(store.getSession(session.id)).toEqual(before);
    expect(store.listMessagePage(session.id).messages).toHaveLength(0);
    expect(() =>
      store.createSession({
        projectId: project.id,
        clientType: "claude-code",
        providerId: claude.id,
        parentSessionId: session.id
      })
    ).toThrow("不同客户端不能互相续接");
    expect(() => store.updateSession(session.id, { providerId: claude.id })).toThrow("不匹配");
    expect(() => store.updateSession(session.id, { clientType: "claude-code" } as never)).toThrow(
      "客户端不能更换"
    );
    expect(store.listSessions(project.id)).toHaveLength(1);
  });

  it("blocks switching while work or queued input still belongs to the old provider", () => {
    const { store, other, session, project, switchTo } = fixture();
    store.updateSession(session.id, { status: "running" });
    expect(() => switchTo(other.id)).toThrow("任务结束");
    store.updateSession(session.id, { status: "idle" });
    store.enqueueTurn({
      sessionId: session.id,
      projectId: project.id,
      message: "pending",
      optionsJson: "{}"
    });
    expect(() => switchTo(other.id)).toThrow("队列");
  });

  it("allows Claude providers to share a native session and keeps forks within that client", () => {
    const { store, claude, project } = fixture();
    const another = store.upsertProvider({ name: "Claude C", kind: "claude-code" });
    const source = store.createSession({ projectId: project.id, providerId: claude.id });
    store.addMessage({
      sessionId: source.id,
      role: "user",
      content: "Review",
      providerId: claude.id,
      eventType: null
    });
    store.updateSession(source.id, { threadId: "claude-original" });
    expect(switchSessionProvider(store, source.id, another.id)).toMatchObject({
      clientType: "claude-code",
      threadId: "claude-original"
    });
    const fork = store.forkSession(source.id)!;
    expect(fork).toMatchObject({ clientType: "claude-code", threadId: null });
    expect(runtimeHistoryContext(store, fork.id, another.id)).toContain("Review");
  });
});
