import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "@codex-omni/db";
import { searchWorkspace } from "./workspace-search.js";

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(
    temps.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("workspace search", () => {
  it("returns sessions and messages for the current project", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-omni-search-"));
    temps.push(directory);
    await writeFile(path.join(directory, "readme.md"), "hello search target\n");
    const store = new Store(":memory:");
    const project = store.createProject({
      name: "Alpha",
      displayPath: directory,
      realPath: directory
    });
    const session = store.createSession({ projectId: project.id, title: "Reconnect notes" });
    store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "explain websocket snapshot replay",
      providerId: null,
      eventType: "user"
    });
    const result = await searchWorkspace({
      store,
      query: "snapshot",
      projectId: project.id,
      rootPath: directory
    });
    expect(result.hits.some((hit) => hit.type === "message")).toBe(true);
    expect(result.hits.some((hit) => hit.type === "file" && hit.path === "readme.md")).toBe(false);
    const files = await searchWorkspace({
      store,
      query: "readme",
      projectId: project.id,
      rootPath: directory
    });
    expect(files.hits.some((hit) => hit.type === "file" && hit.path === "readme.md")).toBe(true);
    const messagesOnly = await searchWorkspace({
      store,
      query: "snapshot",
      projectId: project.id,
      rootPath: directory,
      scope: "message"
    });
    expect(messagesOnly.hits.every((hit) => hit.type === "message")).toBe(true);
    expect(messagesOnly.hits.some((hit) => hit.type === "file")).toBe(false);
    const filesOnly = await searchWorkspace({
      store,
      query: "hello search target",
      projectId: project.id,
      rootPath: directory,
      scope: "file"
    });
    expect(
      filesOnly.hits.some(
        (hit) => hit.type === "file" && hit.snippet?.includes("hello search target")
      )
    ).toBe(true);
    store.updateSession(session.id, { status: "running" });
    const running = await searchWorkspace({
      store,
      query: "Reconnect",
      projectId: project.id,
      rootPath: directory,
      scope: "session",
      status: "running"
    });
    expect(running.hits).toHaveLength(1);
    expect(running.hits[0]?.subtitle).toContain("进行中");
    expect(running.hits[0]?.snippet).toBeTruthy();
    store.db.close();
  });
});
