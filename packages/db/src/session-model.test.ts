import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "./index.js";

let store: Store | undefined;
const directories: string[] = [];
afterEach(() => {
  store?.db.close();
  store = undefined;
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "omni-session-model-"));
  directories.push(directory);
  const file = join(directory, "test.db");
  store = new Store(file);
  const provider = store.upsertProvider({ name: "Provider", model: "default" });
  const project = store.createProject({
    name: "Project",
    displayPath: directory,
    realPath: directory
  });
  const first = store.createSession({ projectId: project.id, providerId: provider.id, model: "x" });
  const second = store.createSession({
    projectId: project.id,
    providerId: provider.id,
    model: "y"
  });
  return { file, provider, project, first, second };
}

describe("per-session models", () => {
  it("persists separate choices through reopen, metadata updates and provider default changes", () => {
    const { file, provider, project, first, second } = fixture();
    store!.updateSession(first.id, { model: "x2" });
    store!.updateSession(first.id, { title: "First" });
    store!.upsertProvider({ ...provider, model: "new-default" });
    store!.db.close();
    store = new Store(file);
    expect(store.getSession(first.id)?.model).toBe("x2");
    expect(store.getSession(second.id)?.model).toBe("y");
    expect(store.listSessions(project.id).find((entry) => entry.id === first.id)?.model).toBe("x2");
    expect(store.forkSession(first.id)?.model).toBe("x2");
    expect(store.createSession({ projectId: project.id, providerId: provider.id }).model).toBe(
      "new-default"
    );
  });

  it("migrates each old conversation from its latest run under its own provider only once", () => {
    const { file, provider, project, first, second } = fixture();
    const other = store!.upsertProvider({ name: "Other", model: "other-default" });
    const empty = store!.createSession({ projectId: project.id, providerId: provider.id });
    for (const [id, sessionId, providerId, model, startedAt] of [
      ["old-a", first.id, provider.id, "old-x", 1],
      ["a", first.id, provider.id, "x", 2],
      ["b", second.id, provider.id, "y", 3],
      ["other", first.id, other.id, "wrong-provider", 4]
    ] as const) {
      store!.createRun({
        id,
        sessionId,
        providerId,
        model,
        startedAt,
        projectId: project.id,
        serviceInstanceId: "test",
        cwd: "/tmp"
      });
    }
    store!.db.exec("ALTER TABLE sessions DROP COLUMN model");
    store!.db.close();
    store = new Store(file);
    expect(store.getSession(first.id)?.model).toBe("x");
    expect(store.getSession(second.id)?.model).toBe("y");
    expect(store.getSession(empty.id)?.model).toBe("default");
    store.updateSession(first.id, { model: "chosen-after-migration" });
    store.db.close();
    store = new Store(file);
    expect(store.getSession(first.id)?.model).toBe("chosen-after-migration");
  });
});
