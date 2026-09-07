import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Store } from "@codex-omni/db";
import { afterEach, describe, expect, it } from "vitest";

let dir: string | undefined;
let child: ChildProcess | undefined;

async function stopServer() {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => {
      child!.once("close", () => resolve());
      child!.kill("SIGTERM");
    });
  }
  child = undefined;
}

afterEach(async () => {
  await stopServer();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("provider runtime settings HTTP contract", () => {
  it("round-trips create/update/clone/import, persists limits, and rejects invalid values", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "omni-provider-api-"));
    const database = path.join(dir, "test.db");
    // Keep the background release check offline; this fixture exercises only
    // our real local HTTP server, authentication and SQLite persistence.
    const offline = path.join(dir, "offline.mjs");
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
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          CODEX_OMNI_HOST: "127.0.0.1",
          CODEX_OMNI_PORT: "0",
          CODEX_OMNI_DATABASE: database,
          CODEX_OMNI_FAKE_RUNTIME: "1",
          CODEX_OMNI_INSTANCE: "provider-api-test",
          CODEX_HOME: path.join(dir, "home")
        }
      }
    );
    const baseUrl = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(
        () => reject(new Error(`Fixture server startup timeout: ${output}`)),
        10_000
      );
      child!.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child!.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error(`Fixture server exited: ${output}`));
      });
      child!.stderr!.on("data", (chunk) => {
        output = (output + String(chunk)).slice(-12000);
      });
      child!.stdout!.on("data", (chunk) => {
        output = (output + String(chunk)).slice(-12000);
        const match = output.match(/Server listening at (http:\/\/127\.0\.0\.1:[1-9]\d*)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]!);
        }
      });
    });
    let cookie = "";
    let csrf = "";
    const call = async (url: string, method = "GET", value?: unknown) => {
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
        ...(value !== undefined ? { body: JSON.stringify(value) } : {})
      });
      return { response, body: (await response.json()) as Record<string, unknown> };
    };
    const setup = await call("/api/auth/setup", "POST", {
      username: "fixture",
      password: "fixture-password-123"
    });
    expect(setup.response.status).toBe(200);
    cookie = setup.response.headers.get("set-cookie")!.split(";")[0]!;
    csrf = String(setup.body.csrfToken);
    const limits = { contextWindow: 32000, autoCompactTokenLimit: 28000 };
    const created = await call("/api/providers", "POST", {
      name: "Small model",
      homeMode: "api-key",
      model: "fixture-small",
      apiKey: "fixture-key",
      baseUrl: "http://127.0.0.1:1/v1",
      ...limits
    });
    expect(created.response.status).toBe(200);
    expect(created.body).toMatchObject(limits);
    expect(created.body.configToml).toContain('wire_api = "responses"');
    expect(created.body.configToml).not.toContain("256000");
    const id = String(created.body.id);
    const updated = await call(`/api/providers/${id}`, "PUT", { name: "Renamed" });
    expect(updated.response.status).toBe(200);
    expect(updated.body).toMatchObject(limits);
    const exported = await call(`/api/providers/${id}/export`);
    expect(exported.body).toMatchObject(limits);
    const cloned = await call(`/api/providers/${id}/clone`, "POST", {});
    expect(cloned.response.status).toBe(200);
    expect(cloned.body).toMatchObject(limits);
    const imported = await call("/api/providers/import", "POST", exported.body);
    expect(imported.response.status).toBe(200);
    expect(imported.body).toMatchObject(limits);
    expect(
      (await call("/api/providers", "POST", { ...exported.body, contextWindow: 0 })).response.status
    ).toBe(400);
    expect(
      (await call(`/api/providers/${id}`, "PUT", { name: "Invalid", contextWindow: 24000 }))
        .response.status
    ).toBe(400);
    expect(
      (
        await call("/api/providers/import", "POST", {
          ...exported.body,
          autoCompactTokenLimit: 64000
        })
      ).response.status
    ).toBe(400);
    const cleared = await call(`/api/providers/${id}`, "PUT", {
      name: "Defaults",
      contextWindow: null,
      autoCompactTokenLimit: null
    });
    expect(cleared.body).toMatchObject({ contextWindow: null, autoCompactTokenLimit: null });
    await stopServer();
    const store = new Store(database);
    try {
      expect(store.getProvider(id)).toMatchObject({
        contextWindow: null,
        autoCompactTokenLimit: null
      });
      expect(store.getProvider(String(cloned.body.id))).toMatchObject(limits);
      expect(store.getProvider(String(imported.body.id))).toMatchObject(limits);
    } finally {
      store.db.close();
    }
  }, 20_000);
});
