import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Store } from "@codex-omni/db";
import { afterEach, describe, expect, it } from "vitest";

let directory: string | undefined;
let child: ChildProcess | undefined;

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => {
      child!.once("close", () => resolve());
      child!.kill("SIGTERM");
    });
  }
  child = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("recent run sessions API", () => {
  it("requires login and returns the latest run for each session", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "omni-recent-runs-"));
    const database = path.join(directory, "test.db");
    const store = new Store(database);
    const project = store.createProject({ name: "Project", displayPath: "/tmp", realPath: "/tmp" });
    const first = store.createSession({ projectId: project.id, title: "First" });
    const second = store.createSession({ projectId: project.id, title: "Second" });
    for (const [id, sessionId, startedAt] of [
      ["first-old", first.id, 10],
      ["second", second.id, 20],
      ["first-new", first.id, 30]
    ] as const) {
      store.createRun({
        id,
        sessionId,
        projectId: project.id,
        serviceInstanceId: "fixture",
        cwd: "/tmp",
        startedAt
      });
    }
    store.db.close();

    const offline = path.join(directory, "offline.mjs");
    await writeFile(
      offline,
      "globalThis.fetch = async () => new Response('{}', { status: 404 });\n"
    );
    child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(offline).href,
        "--import",
        pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
        fileURLToPath(new URL("./index.ts", import.meta.url))
      ],
      {
        cwd: directory,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          CODEX_OMNI_HOST: "127.0.0.1",
          CODEX_OMNI_PORT: "0",
          CODEX_OMNI_DATABASE: database,
          CODEX_OMNI_FAKE_RUNTIME: "1",
          CODEX_OMNI_INSTANCE: "recent-runs-test",
          CODEX_HOME: path.join(directory, "home")
        }
      }
    );
    const baseUrl = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(
        () => reject(new Error(`Server startup timeout: ${output}`)),
        10_000
      );
      child!.once("error", reject);
      child!.once("exit", () => reject(new Error(`Server exited: ${output}`)));
      for (const stream of [child!.stdout!, child!.stderr!]) {
        stream.on("data", (chunk) => {
          output = (output + String(chunk)).slice(-12000);
          const match = output.match(/Server listening at (http:\/\/127\.0\.0\.1:[1-9]\d*)/);
          if (match) {
            clearTimeout(timeout);
            resolve(match[1]!);
          }
        });
      }
    });
    expect((await fetch(`${baseUrl}/api/runs/recent-sessions`)).status).toBe(401);
    const setup = await fetch(`${baseUrl}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "fixture", password: "fixture-password-123" })
    });
    expect(setup.status).toBe(200);
    const cookie = setup.headers.get("set-cookie")!.split(";")[0]!;
    const recent = await fetch(`${baseUrl}/api/runs/recent-sessions`, { headers: { cookie } });
    expect(recent.status).toBe(200);
    expect(await recent.json()).toMatchObject([
      { id: "first-new", sessionTitle: "First", projectName: "Project" },
      { id: "second", sessionTitle: "Second", projectName: "Project" }
    ]);
    const limited = await fetch(`${baseUrl}/api/runs/recent-sessions?limit=1`, {
      headers: { cookie }
    });
    expect((await limited.json()) as Array<unknown>).toHaveLength(1);
  }, 15_000);
});
