import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "./index.js";

let directory: string | undefined;
let store: Store | undefined;
afterEach(() => {
  store?.db.close();
  store = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("session runtime migration", () => {
  it("preserves legacy Codex threads and uses the last inserted message as the initial cursor only once", () => {
    directory = mkdtempSync(path.join(os.tmpdir(), "omni-session-migration-"));
    const file = path.join(directory, "store.db");
    store = new Store(file);
    const provider = store.upsertProvider({ name: "Legacy Codex", kind: "codex" });
    const project = store.createProject({
      name: "Demo",
      displayPath: directory,
      realPath: directory,
      providerId: provider.id
    });
    const session = store.createSession({ projectId: project.id, providerId: provider.id });
    for (const [id, role, content] of [
      ["z-first", "user", "Legacy request"],
      ["a-last", "assistant", "Legacy answer"]
    ] as const) {
      const message = store.addMessage({
        sessionId: session.id,
        providerId: provider.id,
        role,
        content,
        createdAt: 42,
        eventType: null
      });
      store.db.prepare("UPDATE messages SET id=? WHERE id=?").run(id, message.id);
    }
    store.updateSession(session.id, { threadId: "legacy-thread" });
    store.db.exec(
      "DROP TABLE session_runtime_bindings; ALTER TABLE sessions DROP COLUMN client_type;"
    );
    store.db.close();
    store = new Store(file);
    expect(store.getSession(session.id)).toMatchObject({
      clientType: "codex",
      threadId: "legacy-thread"
    });
    const binding = store.getSessionRuntimeBinding(session.id, provider.id);
    expect(binding).toMatchObject({
      clientType: "codex",
      threadId: "legacy-thread",
      lastMessageId: "a-last",
      lastMessageAt: 42
    });
    store.addMessage({
      sessionId: session.id,
      providerId: provider.id,
      role: "user",
      content: "Not yet seen by the native thread",
      eventType: null
    });
    store.db.close();
    store = new Store(file);
    expect(store.getSessionRuntimeBinding(session.id, provider.id)).toEqual(binding);
    expect(store.conversationSince(session.id, { id: "a-last", createdAt: 42 })).toEqual([
      expect.objectContaining({ content: "Not yet seen by the native thread" })
    ]);
  });
});
